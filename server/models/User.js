const { pool } = require('../config/db');


/**
 * Description placeholder
 *
 * @type {{ create({ first_name, last_name, email, password_hash, bio, role }: { first_name: any; last_name: any; email: any; password_hash: any; bio?: string; role?: string; }): unknown; findByEmail(email: any): unknown; findById(id: any): unknown; findAll(): unknown; updateRole(id: any, role: any): unknown; deleteById(id: a...}
/** @type {*} */
const userModel = {
    
    
    /**
     * Creates a new user in the database
     *
     * @async
     * @param {Object} param0 User data Object 
     * @param {*} param0.first_name User's first name
     * @param {*} param0.last_name  User's last name
     * @param {*} param0.email User's email
     * @param {*} param0.password_hash Hashed Password
     * @param {string} [param0.bio=''] User's Biography (optional)
     * @param {string} [param0.role='submitter'] User's role (optional)
     * @returns {Promise<Object>} Created user object 
     */
    async create({first_name, last_name, email, password_hash, bio='', role='submitter'}) {
        const { rows } = await pool.query(
            'INSERT INTO users (first_name, last_name, email, password_hash, bio, role) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *',
            [first_name, last_name, email, password_hash, bio, role]
        );
        return rows[0];
    },

    
    /**
     * Finds a user by their email address
     *
     * @async
     * @param {*} email  User's email address
     * @returns {unknown} User object if found, otherwise undefined
     */
    async findByEmail(email) {
        const {rows} = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
        return rows[0];
    },

    
    /**
     * Finds a user by their ID
     *
     * @async
     * @param {*} id User's unique identifier
     * @returns {unknown} User object if found, otherwise undefined
     */
    async findById(id){
        const {rows} = await pool.query('SELECT * FROM users WHERE id = $1', [id]);
        return rows[0];
    },

    
    /**
     * Retrieves all users from database
     *
     * @async
     * @returns {unknown} Array of user objects (exluding password_hash)
     */
    async findAll(){
        const {rows} = await pool.query('SELECT id, first_name, last_name, email, bio, role, created_at FROM users ORDER BY created_at DESC');
        return rows;
    },

    
    /**
     * Updates a user's role
     *
     * @async
     * @param {*} id User's unique identifier
     * @param {*} role New role for the user
     * @returns {unknown} Updated user object
     */
    async updateRole(id, role){
        const {rows} = await pool.query('UPDATE users SET role = $1 WHERE id = $2 RETURNING *',
            [role, id]
        );

        return rows[0];
    },


    
    /**
     * Deletes a user by their id, cascading through every row that references
     * them so the parent `users` row can actually be removed.
     *
     * The schema only declares `ON DELETE CASCADE` for rows whose parent is a
     * submission (submission_files, reviews-on-submission, messages-on-submission,
     * assignments-on-submission). Rows where the user is the *actor* — reviews
     * they wrote, assignments where they are the reviewer, messages they sent —
     * have no cascade, so a plain `DELETE FROM users` raises a 23503 foreign-key
     * violation as soon as the user has any history. We clean those up
     * explicitly inside a single transaction so the operation is all-or-nothing.
     *
     * The caller is responsible for unlinking any disk-resident upload files
     * for submissions belonging to this user (see {@link findSubmissionFilesForUser}).
     *
     * @async
     * @param {number|string} id  User id to remove.
     * @returns {Promise<number>} `rowCount` for the user delete (`1` on success, `0` if not found).
     */
    async deleteById(id){
        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            // 1. Rows where the user is the actor — no cascade in schema.
            await client.query('DELETE FROM reviews     WHERE reviewer_id = $1', [id]);
            await client.query('DELETE FROM assignments WHERE reviewer_id = $1', [id]);
            await client.query('DELETE FROM messages    WHERE sender_id   = $1', [id]);
            // 2. Submissions owned by the user. The submission_files / reviews /
            //    messages / assignments tied to *those* submissions are removed
            //    automatically by the schema's ON DELETE CASCADE.
            await client.query('DELETE FROM submissions WHERE user_id     = $1', [id]);
            // 3. Finally the user themselves.
            const { rowCount } = await client.query('DELETE FROM users WHERE id = $1', [id]);
            await client.query('COMMIT');
            return rowCount;
        } catch (err) {
            await client.query('ROLLBACK');
            throw err;
        } finally {
            client.release();
        }
    },

    /**
     * Returns the on-disk filename of every upload tied to any submission
     * authored by the given user. The caller can use these to best-effort
     * delete the files from `/uploads` once the DB rows are gone.
     *
     * @async
     * @param {number|string} userId
     * @returns {Promise<string[]>} Array of `submission_files.filename` values.
     */
    async findSubmissionFilesForUser(userId){
        const { rows } = await pool.query(
            `SELECT sf.filename
             FROM submission_files sf
             JOIN submissions s ON s.id = sf.submission_id
             WHERE s.user_id = $1`,
            [userId]
        );
        return rows.map(r => r.filename);
    },


    
    /**
     * Finds all users with a specific role
     *
     * @async
     * @param {*} role User role to filter by
     * @returns {unknown} Array of user objects with a specific role
     */
    async findByRole(role){
        const {rows} = await pool.query('SELECT * FROM users WHERE role = $1', [role]);
        return rows;
    }
};

module.exports = userModel;