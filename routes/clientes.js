const express = require('express');
const pool = require('../db/mysql');
const { consultarDni, consultarRuc } = require('../services/dniService');

const router = express.Router();

// GET /clientes - listar todos
router.get('/', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM cliente');
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /clientes/buscar/:documento - buscar por DNI/RUC en tu BD
router.get('/buscar/:documento', async (req, res) => {
  try {
    const [rows] = await pool.query(
      'SELECT * FROM cliente WHERE documento = ?',
      [req.params.documento]
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: 'Cliente no encontrado en el sistema' });
    }

    const cliente = rows[0];

    const [prestamos] = await pool.query(
      'SELECT id, monto_total, fecha_inicio FROM prestamo WHERE cliente_id = ?',
      [cliente.id]
    );

    res.json({
      cliente,
      prestamo: prestamos[0] || null,
      es_natural: cliente.tipo === 'NATURAL'
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /clientes/crear-desde-api - crea SIEMPRE usando Decolecta
router.post('/crear-desde-api', async (req, res) => {
  const { tipo, documento, email, telefono } = req.body;

  if (!tipo || !documento) {
    return res.status(400).json({ error: 'Tipo y documento son obligatorios' });
  }

  try {
    let nombre = '';

    if (tipo === 'NATURAL') {
      const data = await consultarDni(documento);
      nombre = data.full_name || `${data.first_last_name || ''} ${data.second_last_name || ''} ${data.first_name || ''}`.trim();
    } else if (tipo === 'JURIDICA') {
      const data = await consultarRuc(documento);
      nombre = data.razonSocial || data.full_name || '';
    } else {
      return res.status(400).json({ error: 'Tipo inválido (NATURAL o JURIDICA)' });
    }

    const [result] = await pool.query(
      'INSERT INTO cliente (tipo, nombre, documento, email, telefono) VALUES (?, ?, ?, ?, ?)',
      [tipo, nombre, documento, email || null, telefono || null]
    );

    res.json({
      id: result.insertId,
      tipo,
      nombre,
      documento,
      email: email || null,
      telefono: telefono || null,
      creado: true
    });
  } catch (err) {
    console.error(err);
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(400).json({ error: 'Documento ya registrado en el sistema' });
    }
    res.status(500).json({ error: err.message });
  }
});

// POST /clientes/buscar-o-crear - primero BD, luego API Decolecta
router.post('/buscar-o-crear', async (req, res) => {
  const { tipo, documento, email, telefono } = req.body;

  if (!tipo || !documento) {
    return res.status(400).json({ error: 'Tipo y documento son obligatorios' });
  }

  try {
    // 1) Buscar en BD
    const [rows] = await pool.query(
      'SELECT * FROM cliente WHERE documento = ?',
      [documento]
    );

    if (rows.length > 0) {
      const cliente = rows[0];
      return res.json({
        ...cliente,
        creado: false,
        origen: 'BD'
      });
    }

    // 2) No existe → crear usando Decolecta
    let nombre = '';

    if (tipo === 'NATURAL') {
      const data = await consultarDni(documento);
      nombre = data.full_name || `${data.first_last_name || ''} ${data.second_last_name || ''} ${data.first_name || ''}`.trim();
    } else if (tipo === 'JURIDICA') {
      const data = await consultarRuc(documento);
      nombre = data.razonSocial || data.full_name || '';
    } else {
      return res.status(400).json({ error: 'Tipo inválido (NATURAL o JURIDICA)' });
    }

    const [result] = await pool.query(
      'INSERT INTO cliente (tipo, nombre, documento, email, telefono) VALUES (?, ?, ?, ?, ?)',
      [tipo, nombre, documento, email || null, telefono || null]
    );

    res.json({
      id: result.insertId,
      tipo,
      nombre,
      documento,
      email: email || null,
      telefono: telefono || null,
      creado: true,
      origen: 'API'
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;