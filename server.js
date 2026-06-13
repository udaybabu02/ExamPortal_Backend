require('dotenv').config();
const express = require('express');
const mysql = require('mysql2/promise');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 5000;

// ==========================================
// CONFIGURATION & DATABASE
// ==========================================
app.use(cors({
    origin: [
        'http://localhost:5173', 
        'http://localhost:8081', 
        'https://admin-of-exam.vercel.app', 
        'https://exam-portal-frontend-coral.vercel.app',
        'https://exam-portal-frontend-1yuoy707c-udays-projects-efeeda01.vercel.app'
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

app.get('/', (req, res) => res.send('ARMS Portal Backend is Active!'));

// ==========================================
// 1. STUDENT PORTAL ROUTES
// ==========================================

app.post('/api/register', async (req, res) => {
    try {
        const { name, email, password, mobile, idType, hallTicketNumber, userId } = req.body;
        const sql = 'INSERT INTO users (name, email, password, mobile, id_type, user_id_value, hall_ticket) VALUES (?, ?, ?, ?, ?, ?, ?)';
        await queryWithTimeout(sql, [name || 'Student', email, password, mobile || '', idType || '', (idType === 'college' ? userId : hallTicketNumber), hallTicketNumber]);
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

app.get('/api/exams', async (req, res) => {
    try {
        const [rows] = await queryWithTimeout('SELECT id, subject, duration_minutes, total_questions FROM exams WHERE is_active = TRUE', []);
        res.json(rows);
    } catch (error) {
        res.status(500).json({ message: "Error fetching exams" });
    }
});

app.get('/api/questions/:subject', async (req, res) => {
    try {
        const subject = req.params.subject;
        const [questions] = await queryWithTimeout('SELECT * FROM questions WHERE LOWER(subject) = LOWER(?) ORDER BY RAND() LIMIT 10', [subject]);
        res.json(questions);
    } catch (error) {
        res.status(500).json({ message: "Error fetching questions" });
    }
});

// UPGRADED Results Route: Now saves both the final score AND the individual answers
app.post('/api/results', async (req, res) => {
    try {
        const {
            userId,
            studentName,
            examId,
            percentage,
            passed,
            totalQuestions,
            correctAnswers,
            wrongAnswers,
            answers // <-- Array of individual question answers from frontend
        } = req.body;

        // 1. Insert the main score into the `results` table
        const sql = `
            INSERT INTO results 
            (user_id, student_name, exam_id, score_percentage, status, total_questions, correct_count, wrong_count) 
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `;
        
        const [insertResult] = await queryWithTimeout(sql, [
            userId || 0,
            studentName || 'Unknown Student',
            examId || 'Unknown Exam',
            percentage || 0,
            passed ? 'Pass' : 'Fail', 
            totalQuestions || 10,
            correctAnswers || 0,
            wrongAnswers || 0
        ]);

        const newResultId = insertResult.insertId; // Get the ID of the result we just saved

        // 2. Loop through and save every individual answer into `result_answers`
        if (answers && Array.isArray(answers) && answers.length > 0) {
            for (let ans of answers) {
                const answerSql = `
                    INSERT INTO result_answers (result_id, question_id, selected_option, is_correct) 
                    VALUES (?, ?, ?, ?)
                `;
                // Uses a try-catch inside the loop so one bad answer doesn't crash the whole submission
                try {
                    await queryWithTimeout(answerSql, [
                        newResultId, 
                        ans.questionId, 
                        ans.selected || 'Not answered', 
                        ans.isCorrect ? 1 : 0
                    ]);
                } catch (ansErr) {
                    console.error("Warning: Could not save individual answer:", ansErr.message);
                }
            }
        }
        
        res.status(201).json({ success: true, message: "Exam and answers submitted successfully!" });
    } catch (error) {
        console.error("❌ SUBMISSION ERROR:", error.message);
        res.status(500).json({ success: false, message: "Database error", error: error.message });
    }
});


// ==========================================
// 2. ADMIN PORTAL ROUTES
// ==========================================

app.get('/api/admin/analytics', async (req, res) => {
    try {
        const [[{ count: totalStudents }]] = await queryWithTimeout('SELECT COUNT(*) as count FROM users', []);
        const [[{ count: totalExams }]] = await queryWithTimeout('SELECT COUNT(*) as count FROM exams', []);
        const [[{ count: totalQuestions }]] = await queryWithTimeout('SELECT COUNT(*) as count FROM questions', []);
        
        let totalResults = 0;
        try {
            const [[{ count }]] = await queryWithTimeout('SELECT COUNT(*) as count FROM results', []);
            totalResults = count;
        } catch (e) {}

        res.json({
            totalStudents: totalStudents || 0,
            totalExams: totalExams || 0,
            totalQuestions: totalQuestions || 0,
            totalResults: totalResults || 0
        });
    } catch (error) {
        res.status(500).json({ message: "Error fetching analytics" });
    }
});

app.get('/api/questions', async (req, res) => {
    try {
        const [rows] = await queryWithTimeout('SELECT * FROM questions ORDER BY id DESC', []);
        res.json(rows);
    } catch (error) {
        res.status(500).json({ message: "Error fetching questions" });
    }
});

app.delete('/api/questions/:id', async (req, res) => {
    try {
        await queryWithTimeout('DELETE FROM questions WHERE id = ?', [req.params.id]);
        res.json({ success: true, message: "Question deleted" });
    } catch (error) {
        res.status(500).json({ success: false, message: "Error deleting question" });
    }
});

app.post('/api/questions', async (req, res) => {
    try {
        if (Array.isArray(req.body)) {
            for (let q of req.body) {
                await queryWithTimeout('INSERT INTO questions (subject, question_text, option_a, option_b, option_c, option_d, correct_answer) VALUES (?, ?, ?, ?, ?, ?, ?)', 
                [q.subject || 'Java', q.question_text, q.option_a, q.option_b, q.option_c, q.option_d, q.correct_answer]);
            }
        } else {
            const { subject, question_text, option_a, option_b, option_c, option_d, correct_answer } = req.body;
            await queryWithTimeout('INSERT INTO questions (subject, question_text, option_a, option_b, option_c, option_d, correct_answer) VALUES (?, ?, ?, ?, ?, ?, ?)', 
            [subject, question_text, option_a, option_b, option_c, option_d, correct_answer]);
        }
        res.status(201).json({ success: true, message: "Added successfully" });
    } catch (error) {
        res.status(500).json({ success: false, message: "Error adding questions" });
    }
});

app.get('/api/admin/exams', async (req, res) => {
    try {
        const [rows] = await queryWithTimeout('SELECT * FROM exams ORDER BY id DESC', []);
        res.json(rows);
    } catch (error) {
        res.status(500).json({ message: "Error fetching exams" });
    }
});

app.post('/api/admin/exams', async (req, res) => {
    try {
        const { subject, duration, questions } = req.body;
        await queryWithTimeout('INSERT INTO exams (subject, duration_minutes, total_questions, is_active) VALUES (?, ?, ?, TRUE)', [subject, duration, questions]);
        res.status(201).json({ success: true, message: "Exam created" });
    } catch (error) {
        res.status(500).json({ success: false, message: "Error creating exam" });
    }
});

app.put('/api/admin/exams/:id/toggle', async (req, res) => {
    try {
        await queryWithTimeout('UPDATE exams SET is_active = NOT is_active WHERE id = ?', [req.params.id]);
        res.json({ success: true, message: "Exam visibility toggled" });
    } catch (error) {
        res.status(500).json({ success: false, message: "Error toggling exam" });
    }
});

app.get('/api/admin/results', async (req, res) => {
    try {
        const [rows] = await queryWithTimeout('SELECT * FROM results ORDER BY id DESC', []);
        res.json(rows);
    } catch (error) {
        res.status(500).json({ message: "Error fetching results" });
    }
});

app.get('/api/admin/users', async (req, res) => {
    try {
        const [rows] = await queryWithTimeout('SELECT id, name, email, mobile, id_type, hall_ticket FROM users ORDER BY id DESC', []);
        res.json(rows);
    } catch (error) {
        res.status(500).json({ message: "Error fetching users" });
    }
});

app.listen(PORT, '0.0.0.0', () => console.log(`🚀 Server running on port ${PORT}`));