require('dotenv').config(); // MUST BE AT THE VERY TOP
const express = require('express');
const mysql = require('mysql2/promise');
const cors = require('cors');
const bcrypt = require('bcrypt');

const app = express();
const PORT = process.env.PORT || 5000;

// --- MIDDLEWARE ---
app.use(cors());
app.use(express.json());

// --- DATABASE CONNECTION ---
// Using process.env variables for security and deployment
const pool = mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    port: process.env.DB_PORT || 3306,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

// Test connection on startup
pool.getConnection()
    .then(conn => {
        console.log("✅ Successfully connected to MySQL database");
        conn.release();
    })
    .catch(err => {
        console.error("❌ Database connection failed:", err.message);
    });

// --- ROUTES ---

// 1. Health Check
app.get('/', (req, res) => {
    res.send('ARMS Portal Backend is live and running!');
});

// 2. Get Exams
app.get('/api/exams', async (req, res) => {
    try {
        const [rows] = await pool.query('SELECT * FROM exams WHERE is_active = TRUE');
        res.json(rows);
    } catch (error) {
        console.error("Fetch Exams Error:", error);
        res.status(500).json({ message: "Failed to fetch exams" });
    }
});

// 3. User Registration
app.post('/api/register', async (req, res) => {
    try {
        const { name, email, mobile, password, idType, userId, hallTicket } = req.body;

        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);

        const query = `
            INSERT INTO users (name, email, mobile, password, id_type, user_id_value, hall_ticket)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        `;
        
        await pool.query(query, [name, email, mobile, hashedPassword, idType, userId, hallTicket]);
        res.status(201).json({ message: "Registration successful!" });
    } catch (error) {
        if (error.code === 'ER_DUP_ENTRY') {
            return res.status(400).json({ message: "Account already exists with this email or ID." });
        }
        res.status(500).json({ message: "Server error during registration." });
    }
});

// 4. User Login
app.post('/api/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        const [rows] = await pool.query('SELECT * FROM users WHERE email = ?', [email]);
        
        if (rows.length === 0) {
            return res.status(401).json({ message: "Invalid email or password." });
        }

        const user = rows[0];
        const isMatch = await bcrypt.compare(password, user.password);
        
        if (!isMatch) {
            return res.status(401).json({ message: "Invalid email or password." });
        }

        res.status(200).json({
            message: "Login successful",
            user: { id: user.id, name: user.name, email: user.email }
        });
    } catch (error) {
        res.status(500).json({ message: "Server error during login." });
    }
});

// 5. Save Exam Results (Transaction Based)
app.post('/api/results', async (req, res) => {
    const connection = await pool.getConnection();
    try {
        const { userId, examId, percentage, passed, totalQuestions, correctAnswers, wrongAnswers, answers } = req.body;

        await connection.beginTransaction();

        const resultQuery = `
            INSERT INTO results (user_id, exam_id, score_percentage, status, total_questions, correct_count, wrong_count)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        `;
        const [resultHeader] = await connection.execute(resultQuery, [
            userId, examId, percentage, passed ? 'PASSED' : 'FAILED', totalQuestions, correctAnswers, wrongAnswers
        ]);

        const newResultId = resultHeader.insertId;
        const answerQuery = `INSERT INTO result_answers (result_id, question_id, user_answer, is_correct) VALUES (?, ?, ?, ?)`;

        for (const ans of answers) {
            const pureQuestionId = parseInt(ans.questionId.toString().replace(/\D/g, ''));
            const pureExamId = parseInt(examId.toString().replace(/\D/g, ''));

            await connection.execute(answerQuery, [
                newResultId, 
                pureQuestionId || pureExamId, 
                ans.selected || 'Not answered', 
                ans.isCorrect
            ]);
        }

        await connection.commit();
        res.status(201).json({ message: "Result saved!" });
    } catch (error) {
        await connection.rollback();
        res.status(500).json({ message: "Failed to save results." });
    } finally {
        connection.release();
    }
});

// --- START SERVER ---
app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
});