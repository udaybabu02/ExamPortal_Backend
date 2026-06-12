require('dotenv').config();
const mysql = require('mysql2/promise');

async function cleanAndSeedDatabase() {
    const connection = await mysql.createConnection({
        host: process.env.DB_HOST,
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        database: process.env.DB_NAME,
        port: process.env.DB_PORT || 13699,
        ssl: { rejectUnauthorized: false }
    });

    try {
        console.log("🛠️ 1. Rebuilding the exams table from scratch to fix column errors...");
        
        // This completely wipes the old broken table and its structure
        await connection.query('DROP TABLE IF EXISTS exams;');
        
        // This builds a perfectly clean table with the exact columns your backend expects
        await connection.query(`
            CREATE TABLE exams (
                id INT AUTO_INCREMENT PRIMARY KEY,
                subject VARCHAR(255) NOT NULL,
                duration_minutes INT DEFAULT 10,
                total_questions INT DEFAULT 10,
                is_active BOOLEAN DEFAULT TRUE
            );
        `);
        
        console.log("🌱 2. Inserting fresh, clean subjects (Java, Python, Aptitude)...");
        
        // Inserts the correct data into the newly created table
        await connection.query(`
            INSERT INTO exams (subject, duration_minutes, total_questions, is_active) 
            VALUES 
            ('Java', 10, 10, TRUE),
            ('Python', 10, 10, TRUE),
            ('Aptitude', 10, 10, TRUE);
        `);

        console.log("✅ SUCCESS: Database completely rebuilt and seeded! Refresh your Admin Portal.");
    } catch (err) {
        console.error("❌ ERROR:", err.message);
    } finally {
        await connection.end();
        process.exit();
    }
}

cleanAndSeedDatabase();