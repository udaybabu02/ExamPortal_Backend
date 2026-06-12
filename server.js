require('dotenv').config(); 
const express = require('express');
const mysql = require('mysql2/promise');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 5000;

// --- CORS Configuration ---
app.use(cors({
    origin: [
        'http://localhost:5173', 
        'http://localhost:8081', 
        'http://localhost:8082',
        'https://admin-of-exam.vercel.app', 
        'https://exam-portal-frontend-coral.vercel.app'
    ],
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    credentials: true
})); 
app.use(express.json());

// --- Database Connection (Aiven Cloud) ---
const pool = mysql.createPool({
    host: process.env.DB_HOST, 
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD, 
    database: process.env.DB_NAME,
    port: parseInt(process.env.DB_PORT) || 13699, 
    ssl: { rejectUnauthorized: false },
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    enableKeepAlive: true,
    keepAliveInitialDelay: 10000
});

app.get('/', (req, res) => res.send('ARMS Portal Backend is Active on Aiven Cloud'));

// ==========================================
// ADMIN ROUTES
// ==========================================

app.get('/api/admin/exams', async (req, res) => {
    try {
        const [rows] = await pool.query('SELECT id, subject, duration_minutes, total_questions, is_active FROM exams ORDER BY id DESC');
        res.json(rows);
    } catch (error) { res.status(500).json({ message: "Failed to fetch exams" }); }
});

app.put('/api/admin/exams/:id/toggle', async (req, res) => {
    try {
        await pool.execute('UPDATE exams SET is_active = ? WHERE id = ?', [req.body.is_active, req.params.id]);
        res.json({ message: "Status updated" });
    } catch (error) { res.status(500).json({ message: "Toggle failed" }); }
});

app.get('/api/questions', async (req, res) => {
    try {
        const [rows] = await pool.query('SELECT * FROM questions ORDER BY id DESC');
        res.json(rows);
    } catch (error) { res.status(500).json([]); }
});

app.get('/api/admin/results', async (req, res) => {
    try {
        const [rows] = await pool.query('SELECT * FROM results ORDER BY id DESC');
        res.json(rows);
    } catch (error) { res.status(500).json([]); }
});

app.get('/api/admin/users', async (req, res) => {
    try {
        const [rows] = await pool.query('SELECT * FROM users ORDER BY id DESC');
        res.json(rows);
    } catch (error) { res.status(500).json([]); }
});

app.get('/api/admin/analytics', async (req, res) => {
    try {
        res.json({ message: "Analytics endpoint active" });
    } catch (error) { res.status(500).json({}); }
});

// ==========================================
// STUDENT ROUTES
// ==========================================

app.get('/api/exams', async (req, res) => {
    try {
        const [rows] = await pool.query('SELECT id, subject, duration_minutes, total_questions FROM exams WHERE is_active = TRUE');
        res.json(rows);
    } catch (error) { res.status(500).send("Error fetching exams"); }
});

app.get('/api/questions/:subject', async (req, res) => {
    try {
        const subjectName = decodeURIComponent(req.params.subject);
        const query = `SELECT id, question_text, option_a, option_b, option_c, option_d, correct_answer 
                       FROM questions WHERE LOWER(subject) = LOWER(?) ORDER BY RAND() LIMIT 10`;
        const [rows] = await pool.query(query, [subjectName]);
        res.json(rows);
    } catch (error) { res.status(500).json({ message: "Server Error" }); }
});

app.post('/api/results', async (req, res) => {
    const connection = await pool.getConnection();
    try {
        const { userId, studentName, examId, percentage, totalQuestions, correctAnswers, passed } = req.body;
        await connection.beginTransaction();

        // OTP Crash Fix: Converts "otp-user" text safely to numeric 0
        let safeUserId = parseInt(userId, 10);
        if (isNaN(safeUserId)) {
            safeUserId = 0; 
        }

        const [examRows] = await connection.query('SELECT id FROM exams WHERE LOWER(subject) = LOWER(?) LIMIT 1', [examId]);
        const actualExamId = examRows.length > 0 ? examRows[0].id : 0; 

        const status = passed ? 'PASSED' : 'FAILED';

        await connection.execute(
            'INSERT INTO results (user_id, student_name, exam_id, score_percentage, status, total_questions, correct_count) VALUES (?, ?, ?, ?, ?, ?, ?)', 
            [safeUserId, studentName, actualExamId, percentage, status, totalQuestions, correctAnswers]
        );
        
        await connection.commit();
        res.status(201).json({ score: percentage });
    } catch (error) {
        await connection.rollback();
        console.error("❌ CRITICAL SUBMISSION ERROR:", error);
        res.status(500).json({ message: "Evaluation failed.", error: error.message });
    } finally {
        connection.release();
    }
});

// Auth endpoints
// NOTE: If you previously had code inside these blocks for database login, 
// make sure to paste it back in here!
app.post('/api/login', async (req, res) => { /* Your existing login logic */ });
app.post('/api/register', async (req, res) => { /* Your existing register logic */ });

// Render Deployment Fix
app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Server running on port ${PORT}`);
});