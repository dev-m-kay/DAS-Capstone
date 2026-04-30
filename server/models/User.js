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
     * Deletes a user by their ID
     *
     * @async
     * @param {a} id User's unique identifier
     * @returns {unknown} Array of deleted rows (empty if none deleted)
     */
    async deleteById(id){
        const {rows} = await pool.query('DELETE FROM users WHERE id = $1',
            [id]
        );
        return rows;
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