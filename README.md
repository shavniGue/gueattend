# GUEAttend — Graphic Era University (GEU) Attendance & Assignment Tracker

> **Never miss an attendance update or assignment deadline again.**

GUEAttend is a full-stack student utility that connects with **Graphic Era University ERP (`student.geu.ac.in`)** to monitor attendance and assignments, store student data securely, and send timely updates through **Telegram (@gue_attendance_bot)**.

## 🔗 Official GEU ERP Portal Links

1. **GEU ERP Login:** [https://student.geu.ac.in/N0j5Ha0](https://student.geu.ac.in/N0j5Ha0)
2. **GEU ERP Timetable:** [https://student.geu.ac.in/P0btHKF1DtpZzThe_BuxfULbSZc_QvAAt3MCzUmDOUv7](https://student.geu.ac.in/P0btHKF1DtpZzThe_BuxfULbSZc_QvAAt3MCzUmDOUv7)
3. **GEU ERP Dashboard:** [https://student.geu.ac.in/P0btHKF1DtpZzThe_BuxfULbSZc_QvAAp3scwF-NOlX6](https://student.geu.ac.in/P0btHKF1DtpZzThe_BuxfULbSZc_QvAAp3scwF-NOlX6)

## 🤖 Telegram Bot Details

- **Bot Name:** GUE Attendance Bot
- **Bot Username:** [@gue_attendance_bot](https://t.me/gue_attendance_bot)
- **Commands:** `/start`, `/attendance`, `/today`, `/DD/MM/YY`, `/assignments`, `/status`, `/reconnect`, `/help`

## ✨ Key Features

### 🎓 Graphic Era University ERP Integration
- **Single Unified ERP:** Simplified and purpose-built for Graphic Era University students (no dual ERP clutter).
- **Secure Authentication:** Captcha relay and session management with AES-256-GCM encryption.
- **Identity Auto-Detection:** Automatically extracts student name, GEU Student ID, semester, and course.
- **Session Recovery:** Seamless 1-Click reconnection when the portal session expires.

### 📊 Automated Attendance Monitoring
- **Real-time Live Polling:** Detects class attendance marked by professors (`N → P`, `N → A`, `P → A`, `A → P`).
- **Original Date Preservation:** Alerts always display the actual lecture date rather than the detection timestamp.
- **75% Attendance Calculator:** Mathematical calculation of exact attendance percentages, bunk buffer, and classes needed to reach 75%.
- **Daily Timetable:** Automatic 8:30 AM IST schedule alert with classroom, subject code, and faculty details.

### 🔔 Notification Pipeline
```text
GEU ERP (student.geu.ac.in)
  ↓
Attendance / Assignment Change
  ↓
GUEAttend Watcher
  ↓
Validate User + Date + State
  ↓
Persistent PostgreSQL Deduplication
  ↓
Telegram Bot (@gue_attendance_bot)
  ↓
Student Telegram Chat
```

## 🛠️ Tech Stack & Services

- **Backend:** Node.js, Express, Playwright, node-telegram-bot-api, pg
- **Database:** Supabase PostgreSQL
- **Authentication:** Firebase Auth (`gueattend`)
- **Email:** Resend API
- **Admin Email:** `shavnikumarigue@gmail.com`

## 🚀 Environment Setup

Copy `.env.example` to `.env` and configure:

```ini
PORT=3000
DATABASE_URL=postgresql://postgres.cnpullmxupyqdndxzbih:...@aws-0-ap-southeast-2.pooler.supabase.com:5432/postgres
GEU_LOGIN_URL=https://student.geu.ac.in/N0j5Ha0
GEU_TIMETABLE_URL=https://student.geu.ac.in/P0btHKF1DtpZzThe_BuxfULbSZc_QvAAt3MCzUmDOUv7
GEU_DASHBOARD_URL=https://student.geu.ac.in/P0btHKF1DtpZzThe_BuxfULbSZc_QvAAp3scwF-NOlX6
TELEGRAM_BOT_TOKEN=9295459826:AAFMEClgvi12x1HKHyTFG-E412s5101c7SY
TELEGRAM_BOT_USERNAME=gue_attendance_bot
ADMIN_EMAILS=shavnikumarigue@gmail.com
FIREBASE_PROJECT_ID=gueattend
```

## 🧪 Testing

Run test suite:
```bash
npm test
```

## 📌 Repository

Repository: [https://github.com/shavniGue/gueattend.git](https://github.com/shavniGue/gueattend.git)
