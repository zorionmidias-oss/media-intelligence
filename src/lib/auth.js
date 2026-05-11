'use strict';
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'mediaintel-2juniors-secret-change-in-prod';
const JWT_EXPIRES = '7d';
const COOKIE_NAME = 'auth_token';

function hashPassword(senha) {
  return bcrypt.hash(senha, 10);
}

function verifyPassword(senha, hash) {
  return bcrypt.compare(senha, hash);
}

function generateToken(userId) {
  return jwt.sign({ uid: userId }, JWT_SECRET, { expiresIn: JWT_EXPIRES });
}

function verifyToken(token) {
  if (!token) return null;
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    return payload.uid;
  } catch {
    return null;
  }
}

function requireAuth(req, res, next) {
  const token = req.cookies?.[COOKIE_NAME] || req.headers.authorization?.replace('Bearer ', '');
  const userId = verifyToken(token);
  if (!userId) {
    if (req.path.startsWith('/api/')) {
      return res.status(401).json({ error: 'Não autenticado' });
    }
    return res.redirect('/login.html');
  }
  req.userId = userId;
  next();
}

module.exports = { hashPassword, verifyPassword, generateToken, verifyToken, requireAuth, COOKIE_NAME };
