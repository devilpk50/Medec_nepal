require('dotenv').config();
const mysql = require('mysql2/promise');

async function setupFaculty() {
    try {
        const connection = await mysql.createConnection({
            host: process.env.DB_HOST || 'localhost',
            user: process.env.DB_USER || 'root',
            password: process.env.DB_PASSWORD || '',
            database: process.env.DB_NAME || 'medecnepal'
        });

        console.log("Connected to MySQL. Creating Faculty table...");

        await connection.query(`
            CREATE TABLE IF NOT EXISTS faculty (
                id INT AUTO_INCREMENT PRIMARY KEY,
                name VARCHAR(100) NOT NULL,
                subject VARCHAR(100) NOT NULL,
                bio TEXT,
                image_url VARCHAR(255) DEFAULT 'assets/img/hero-graphic.png',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        console.log("✅ Faculty table created.");

        // Seed sample faculty
        const [existing] = await connection.query('SELECT id FROM faculty LIMIT 1');
        if (existing.length === 0) {
            await connection.query(`
                INSERT INTO faculty (name, subject, bio) VALUES 
                ('Dr. Ramesh Sharma', 'Physics Expert', '15+ years of experience teaching Physics for CEE and NEB. Former Head of Department at top medical institutes.'),
                ('Dr. Anita Thapa', 'Biology Specialist', 'Renowned Zoology author and expert in medical entrance preparations with a 99% success rate.'),
                ('Prof. K.C. Poudel', 'Chemistry Guru', 'Master of Organic Chemistry. Simplifies complex reaction mechanisms into easy-to-remember tricks.')
            `);
            console.log("✅ Sample faculty seeded.");
        } else {
            console.log("⚠️ Faculty already seeded.");
        }

        await connection.end();
    } catch (err) {
        console.error("❌ Error setting up faculty:", err.message);
    }
}

setupFaculty();
