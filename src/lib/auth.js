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

function generateToken(userId, perfil) {
  return jwt.sign({ uid: userId, perfil: perfil || 'admin' }, JWT_SECRET, { expiresIn: JWT_EXPIRES });
}

// Returns { uid, perfil } or null. perfil defaults to 'admin' for legacy tokens.
function verifyToken(token) {
  if (!token) return null;
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    return { uid: payload.uid, perfil: payload.perfil || 'admin' };
  } catch {
    return null;
  }
}

function requireAuth(req, res, next) {
  const token = req.cookies?.[COOKIE_NAME] || req.headers.authorization?.replace('Bearer ', '');
  const payload = verifyToken(token);
  if (!payload) {
    if (req.path.startsWith('/api/')) {
      return res.status(401).json({ error: 'Não autenticado' });
    }
    const ua = req.headers['user-agent'] || '';
    const isMobile = /Mobile|Android|iPhone|iPad|iPod/i.test(ua);
    const isMobilePath = req.path.includes('/mobile') || req.path === '/m';
    if (isMobile || isMobilePath) {
      return res.redirect('/login-mobile.html');
    }
    return res.redirect('/login.html');
  }
  req.userId = payload.uid;
  req.userPerfil = payload.perfil;
  next();
}

// Bloqueia qualquer usuário que não seja admin (usa perfil fresco do porteiro quando há).
function requireAdmin(req, res, next) {
  const perfil = req.fullUser?.perfil || req.userPerfil;
  if (perfil !== 'admin') {
    return res.status(403).json({ error: 'Acesso negado' });
  }
  next();
}

module.exports = { hashPassword, verifyPassword, generateToken, verifyToken, requireAuth, requireAdmin, COOKIE_NAME };
