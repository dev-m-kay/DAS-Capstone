// const router = require('express').Router();
// const express = require('express')
// const {createClient} = require('@supabase/supabase-js');


// const app = express()
// app.use(express.json());
// app.use(express.urlencoded({extended: true}));
const bcrypt = require('bcryptjs');
const User = require('../models/User');
const {generateToken} = require('../middleware/auth')



exports.login = async (req, res)=>{ //Add input validation
    try{
      const { email, password } = req.body;

      const user = await User.findByEmail(email); 
      if (!user|| !await bcrypt.compare(password, user.password_hash)){
          return res.status(401).json({error: 'Invalid credentials'});
      }

      const token = generateToken(user.id);
      res.json({token, user: {id: user.id, email: user.email} });
    } catch(err){
      console.error(err);
      res.status(500).json({eror: 'Something went wrong'});
    }

};



exports.register = async(req, res) =>{ //add input validation
  try{  
  const { first_name, last_name, email, password, bio, role} = req.body;

    const hashPassword = async (password) => {
      const salt = await bcrypt.genSalt(12);
      return bcrypt.hash(password, salt);
    };

  // Check if user exists
  const existingUser = await User.findByEmail( email );
  if (existingUser) {
    return res.status(400).json({ error: 'Email already registered' });
  }

  // Hash password
  const hashedPassword = await hashPassword(password);

  // Create user
  const user = await User.create({
    first_name, 
    last_name,
    email,
    password_hash: hashedPassword,
    bio,
    role //I'm thinking this will be moved somewhere else later.
  });

  const token = generateToken(user);
  res.status(201).json({ token, user: {  id: user.id, first_name: user.first_name, last_name: user.last_name, email: user.email, role: user.role} });
}catch(err){
  console.error(err);
  res.status(500).json({eror: 'Something went wrong'});
}
};


exports.me = async(req, res) => {
    try {
    // Fetch user details using decoded token
    const user = await User.findById(req.user.id );
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    res.status(200).json({  id: user.id, first_name: user.first_name, last_name: user.last_name, email: user.email, role: user.role, bio: user.bio, created_at: user.created_at});
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
};

// TODO: Add auth routes (POST /register, POST /login, GET /me)