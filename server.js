require('dotenv').config();
const express = require('express');
const mysql = require('mysql2/promise');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 5000;

// All origins allowed for both Student and Admin portals
app.use(cors({
    origin: [
        'http://localhost:5173', 
        'http://localhost:8081', 
        'https://admin-of-exam.vercel.app', 
        'https://exam-portal-frontend-coral.vercel.app',
        'https://exam-portal-frontend-1yuy707c-udays-projects-efeeda01.vercel.app'
    ],
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    credentials: true
})); 
app.use(express.json());

const pool = mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    port: parseInt(process.env.DB_PORT) || 13699,
    ssl: { rejectUnauthorized: false },
    connectionLimit: 10
});

// Helper for database queries with safety timeout
const queryWithTimeout = async (sql, params, timeoutMs = 8000) => {
    let timeoutHandle;
    const timeoutPromise = new Promise((_, reject) => {
        timeoutHandle = setTimeout(() => reject(new Error('DB_TIMEOUT')), timeoutMs);
    });
    try {
        return await Promise.race([pool.query(sql, params), timeoutPromise]);
    } finally {
        clearTimeout(timeoutHandle);
    }
};

// --- ROUTES ---
app.get('/', (req, res) => res.send('ARMS Portal Backend is Active!'));

// 1. User Routes
app.post('/api/register', async (req, res) => {
    try {
        const { name, email, password, mobile, idType, hallTicketNumber, userId } = req.body;
        const sql = 'INSERT INTO users (name, email, password, mobile, id_type, user_id_value, hall_ticket) VALUES (?, ?, ?, ?, ?, ?, ?)';
        await queryWithTimeout(sql, [name, email, password, mobile, idType, (idType === 'college' ? userId : hallTicketNumber), hallTicketNumber]);
        res.status(201).json({ success: true, message: "Registration successful" });
    } catch (error) {
        res.status(500).json({ success: false, message: "Database error", details: error.message });
    }
});

app.post('/api/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        const [users] = await queryWithTimeout('SELECT * FROM users WHERE email = ?', [email]);
        if (users.length > 0 && users[0].password === password) {
            res.json({ success: true, user: users[0] });
        } else {
            res.status(401).json({ success: false, message: "Invalid credentials" });
        }
    } catch (error) {
        res.status(500).json({ success: false, message: "Login error" });
    }
});

// 2. Exam Routes (For Student)
app.get('/api/exams', async (req, res) => {
    try {
        const [rows] = await queryWithTimeout('SELECT id, subject, duration_minutes, total_questions FROM exams WHERE is_active = TRUE', []);
        res.json(rows);
    } catch (error) {
        res.status(500).json({ message: "Error fetching exams" });
    }
});

// 3. Admin Routes (Fixes 404s in Admin Portal)
app.post('/api/admin/exams', async (req, res) => {
    try {
        const { subject, duration, questions } = req.body;
        await queryWithTimeout('INSERT INTO exams (subject, duration_minutes, total_questions, is_active) VALUES (?, ?, ?, TRUE)', [subject, duration, questions]);
        res.status(201).json({ success: true, message: "Exam created" });
    } catch (error) {
        res.status(500).json({ success: false, message: "Error creating exam" });
    }
});

app.get('/api/admin/users', async (req, res) => {
    try {
        const [rows] = await queryWithTimeout('SELECT id, name, email, mobile, id_type, hall_ticket FROM users', []);
        res.json(rows);
    } catch (error) {
        res.status(500).json({ message: "Error fetching users" });
    }
});

app.listen(PORT, '0.0.0.0', () => console.log(`🚀 Server running on port ${PORT}`));