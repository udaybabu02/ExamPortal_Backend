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
        const { id } = req.params;
        const { is_active } = req.body;
        await pool.execute('UPDATE exams SET is_active = ? WHERE id = ?', [is_active, id]);
        res.json({ message: "Status updated" });
    } catch (error) { res.status(500).json({ message: "Toggle failed" }); }
});

// ==========================================
// STUDENT ROUTES
// ==========================================

// 1. Fetch only visible/active exams
app.get('/api/exams', async (req, res) => {
    try {
        const [rows] = await pool.query('SELECT id, subject, duration_minutes, total_questions FROM exams WHERE is_active = TRUE');
        res.json(rows);
    } catch (error) { res.status(500).send("Error fetching exams"); }
});

// 2. Fetch 10 random questions for a specific subject
app.get('/api/questions/:subject', async (req, res) => {
    try {
        const subjectName = decodeURIComponent(req.params.subject);
        const query = `SELECT id, question_text, option_a, option_b, option_c, option_d, correct_answer 
                       FROM questions WHERE LOWER(subject) = LOWER(?) ORDER BY RAND() LIMIT 10`;
        const [rows] = await pool.query(query, [subjectName]);
        res.json(rows);
    } catch (error) { res.status(500).json({ message: "Server Error" }); }
});

// 3. Submit Exam Results
app.post('/api/results', async (req, res) => {
    const connection = await pool.getConnection();
    try {
        const { userId, studentName, examId, percentage, totalQuestions, correctAnswers, passed } = req.body;
        await connection.beginTransaction();

        // FIX: Find the numeric ID for the subject string (e.g., "Java" -> 1)
        const [examRows] = await connection.query('SELECT id FROM exams WHERE LOWER(subject) = LOWER(?) LIMIT 1', [examId]);
        const actualExamId = examRows.length > 0 ? examRows[0].id : 0; 

        const status = passed ? 'PASSED' : 'FAILED';

        await connection.execute(
            'INSERT INTO results (user_id, student_name, exam_id, score_percentage, status, total_questions, correct_count) VALUES (?, ?, ?, ?, ?, ?, ?)', 
            [userId, studentName, actualExamId, percentage, status, totalQuestions, correctAnswers]
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
app.post('/api/login', async (req, res) => { /* Your existing login logic */ });
app.post('/api/register', async (req, res) => { /* Your existing register logic */ });

// FIX: Bound server to 0.0.0.0 to pass Render's port scan
app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Server running on port ${PORT}`);
});