const express = require("express");
const session = require("express-session");
const helmet = require("helmet");
const bcrypt = require("bcryptjs");
const { Pool } = require("pg");
const path = require("path");
const crypto = require("crypto");

const app = express();
const PORT = process.env.PORT || 10000;
const isProd = process.env.NODE_ENV === "production";

if (!process.env.DATABASE_URL) {
  console.warn("DATABASE_URL is not set. PostgreSQL is required for normal operation.");
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: isProd ? { rejectUnauthorized: false } : false
});

app.set("trust proxy", 1);
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'"],
      imgSrc: ["'self'", "data:"],
      connectSrc: ["'self'"]
    }
  }
}));
app.use(express.json({ limit: "100kb" }));
app.use(express.urlencoded({ extended: false, limit: "100kb" }));
app.use(session({
  secret: process.env.SESSION_SECRET || "development-only-change-me",
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure: isProd,
    sameSite: "lax",
    maxAge: 8 * 60 * 60 * 1000
  }
}));
app.use(express.static(path.join(__dirname, "public")));

function reference() {
  return "LN-" + new Date().toISOString().slice(0,10).replaceAll("-","") + "-" +
    crypto.randomBytes(3).toString("hex").toUpperCase();
}

function clean(v, max = 200) {
  return String(v ?? "").trim().slice(0, max);
}

async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS loan_products (
      id SERIAL PRIMARY KEY,
      name VARCHAR(120) NOT NULL,
      min_amount NUMERIC(14,2) NOT NULL,
      max_amount NUMERIC(14,2) NOT NULL,
      annual_rate NUMERIC(7,4) NOT NULL,
      term_months INTEGER NOT NULL,
      active BOOLEAN NOT NULL DEFAULT TRUE
    );

    CREATE TABLE IF NOT EXISTS loan_applications (
      id SERIAL PRIMARY KEY,
      reference VARCHAR(40) UNIQUE NOT NULL,
      full_name VARCHAR(160) NOT NULL,
      phone VARCHAR(40) NOT NULL,
      email VARCHAR(180),
      national_id VARCHAR(100),
      employment VARCHAR(160),
      monthly_income NUMERIC(14,2) NOT NULL,
      amount NUMERIC(14,2) NOT NULL,
      term_months INTEGER NOT NULL,
      purpose VARCHAR(500) NOT NULL,
      status VARCHAR(30) NOT NULL DEFAULT 'pending',
      admin_note TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS audit_logs (
      id SERIAL PRIMARY KEY,
      action VARCHAR(120) NOT NULL,
      reference VARCHAR(40),
      detail TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  const count = await pool.query("SELECT COUNT(*)::int AS n FROM loan_products");
  if (count.rows[0].n === 0) {
    await pool.query(`
      INSERT INTO loan_products (name,min_amount,max_amount,annual_rate,term_months)
      VALUES
      ('Standard Loan', 1000, 1000000, 24, 48),
      ('Short Term Loan', 1000, 250000, 30, 12)
    `);
  }
}

function requireAdmin(req, res, next) {
  if (!req.session.admin) return res.status(401).json({ success:false, message:"Admin authentication required." });
  next();
}

app.get("/health", async (req, res) => {
  try {
    await pool.query("SELECT 1");
    res.json({ status:"ok", database:"ok" });
  } catch {
    res.status(503).json({ status:"degraded", database:"unavailable" });
  }
});

app.get("/api/loans", async (req,res) => {
  const r = await pool.query("SELECT id,name,min_amount,max_amount,annual_rate,term_months FROM loan_products WHERE active=true ORDER BY id");
  res.json({success:true, loans:r.rows});
});

app.post("/api/applications", async (req,res) => {
  try {
    const fullName = clean(req.body.fullName,160);
    const phone = clean(req.body.phone,40);
    const email = clean(req.body.email,180);
    const nationalId = clean(req.body.nationalId,100);
    const employment = clean(req.body.employment,160);
    const monthlyIncome = Number(req.body.monthlyIncome);
    const amount = Number(req.body.amount);
    const termMonths = Number(req.body.termMonths);
    const purpose = clean(req.body.purpose,500);

    if (!fullName || !phone || !Number.isFinite(monthlyIncome) || monthlyIncome <= 0 ||
        !Number.isFinite(amount) || amount <= 0 || !Number.isInteger(termMonths) ||
        termMonths < 1 || !purpose) {
      return res.status(400).json({success:false,message:"Please provide all required application details."});
    }

    const product = await pool.query(
      "SELECT * FROM loan_products WHERE active=true AND min_amount <= $1 AND max_amount >= $1 AND term_months=$2 LIMIT 1",
      [amount, termMonths]
    );
    if (!product.rowCount) {
      return res.status(400).json({success:false,message:"The requested amount and term are not currently available."});
    }

    const ref = reference();
    await pool.query(`
      INSERT INTO loan_applications
      (reference,full_name,phone,email,national_id,employment,monthly_income,amount,term_months,purpose)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
    `,[ref,fullName,phone,email || null,nationalId || null,employment || null,monthlyIncome,amount,termMonths,purpose]);

    await pool.query("INSERT INTO audit_logs(action,reference,detail) VALUES($1,$2,$3)",
      ["application_created",ref,"New loan application submitted"]);

    res.status(201).json({success:true,reference:ref,status:"pending"});
  } catch (e) {
    console.error(e);
    res.status(500).json({success:false,message:"Unable to submit application."});
  }
});

app.get("/api/applications/:reference", async (req,res) => {
  const r = await pool.query(
    "SELECT reference,full_name,amount,term_months,status,admin_note,created_at,updated_at FROM loan_applications WHERE reference=$1",
    [clean(req.params.reference,40)]
  );
  if (!r.rowCount) return res.status(404).json({success:false,message:"Application not found."});
  res.json({success:true,application:r.rows[0]});
});

app.post("/api/admin/login", async (req,res) => {
  const username = clean(req.body.username,100);
  const password = String(req.body.password || "");
  const configuredUser = process.env.ADMIN_USERNAME || "admin";
  const configuredPass = process.env.ADMIN_PASSWORD || "change-me";

  const okUser = crypto.timingSafeEqual(Buffer.from(username), Buffer.from(configuredUser.padEnd(username.length, " ")).subarray(0, username.length))
    && username.length === configuredUser.length;

  if (!okUser || password !== configuredPass) {
    return res.status(401).json({success:false,message:"Invalid administrator credentials."});
  }

  req.session.admin = true;
  req.session.username = username;
  await pool.query("INSERT INTO audit_logs(action,detail) VALUES($1,$2)",["admin_login","Administrator signed in"]);
  res.json({success:true});
});

app.post("/api/admin/logout", requireAdmin, (req,res) => {
  req.session.destroy(() => res.json({success:true}));
});

app.get("/api/admin/me", requireAdmin, (req,res) => res.json({success:true,username:req.session.username}));

app.get("/api/admin/applications", requireAdmin, async (req,res) => {
  const r = await pool.query("SELECT * FROM loan_applications ORDER BY created_at DESC");
  res.json({success:true,applications:r.rows});
});

app.patch("/api/admin/applications/:id", requireAdmin, async (req,res) => {
  const id = Number(req.params.id);
  const status = clean(req.body.status,30).toLowerCase();
  const note = clean(req.body.note,2000);

  if (!Number.isInteger(id) || !["pending","approved","rejected","under_review"].includes(status)) {
    return res.status(400).json({success:false,message:"Invalid application update."});
  }

  const r = await pool.query(`
    UPDATE loan_applications
    SET status=$1, admin_note=$2, updated_at=NOW()
    WHERE id=$3
    RETURNING reference,status
  `,[status,note || null,id]);

  if (!r.rowCount) return res.status(404).json({success:false,message:"Application not found."});

  await pool.query("INSERT INTO audit_logs(action,reference,detail) VALUES($1,$2,$3)",
    ["application_status_changed",r.rows[0].reference,`Status changed to ${status}`]);

  res.json({success:true,application:r.rows[0]});
});

app.get("/api/admin/audit", requireAdmin, async (req,res) => {
  const r = await pool.query("SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT 500");
  res.json({success:true,logs:r.rows});
});

app.get("*", (req,res) => res.sendFile(path.join(__dirname,"public","index.html")));

initDb().then(() => {
  app.listen(PORT, () => console.log(`Secure Loan Platform listening on ${PORT}`));
}).catch(err => {
  console.error("Database initialization failed:", err);
  process.exit(1);
});
