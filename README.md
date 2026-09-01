# Secure Loan Platform

A production-oriented loan application platform designed for deployment through GitHub and Render.

## Security boundary

This repository deliberately does **not** collect, store, transmit, or request:
- mobile-money PINs
- banking passwords
- SMS contents containing authentication codes
- one-time passwords belonging to a financial account

Payment/disbursement should be connected only through an authorized provider API.

## Included

- Public loan calculator
- Loan application form
- PostgreSQL persistence
- Admin login
- Admin application dashboard
- Approve/reject workflow
- Applicant status lookup
- Audit log
- Security headers
- Secure session cookies in production
- Render blueprint
- Health endpoint

## Local

1. Install Node.js 20+.
2. Create PostgreSQL database.
3. Copy `.env.example` to `.env`.
4. Set `DATABASE_URL`, `SESSION_SECRET`, `ADMIN_USERNAME`, and `ADMIN_PASSWORD`.
5. Run `npm install`.
6. Run `npm start`.
7. Open `http://localhost:10000`.

The database schema is created automatically on startup.

## GitHub → Render

1. Create a GitHub repository.
2. Upload all files in this folder.
3. Push to GitHub.
4. In Render, choose **New + → Blueprint**.
5. Select the repository.
6. Render reads `render.yaml` and creates the web service and PostgreSQL database.
7. Set the `ADMIN_USERNAME` and `ADMIN_PASSWORD` values when prompted.
8. Deploy.

## Production notes

For a real lending operation, configure:
- a custom domain and HTTPS
- a strong unique admin password
- a strong random session secret
- appropriate database backups/retention
- rate limiting/WAF
- identity/KYC provider where legally required
- an authorized payment provider integration
- legal/privacy/consumer-credit compliance appropriate to the operating country

## API

### Public
- `GET /health`
- `GET /api/loans`
- `POST /api/applications`
- `GET /api/applications/:reference`

### Admin
- `POST /api/admin/login`
- `POST /api/admin/logout`
- `GET /api/admin/me`
- `GET /api/admin/applications`
- `PATCH /api/admin/applications/:id`
- `GET /api/admin/audit`

