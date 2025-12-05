const express = require('express');
const pool = require('../db/mysql');

const router = express.Router();

const MAX_CUOTAS = 24;
const MAX_MONTO = 20000;

// POST /prestamos - crear préstamo + cronograma
router.post('/', async (req, res) => {
  const { cliente_id, monto_total, num_cuotas } = req.body;

  if (!cliente_id || !monto_total || !num_cuotas) {
    return res.status(400).json({ error: 'cliente_id, monto_total y num_cuotas son obligatorios' });
  }

  if (monto_total <= 0) {
    return res.status(400).json({ error: 'El monto debe ser mayor a 0' });
  }

  if (monto_total > MAX_MONTO) {
    return res.status(400).json({ error: `Monto máximo permitido: ${MAX_MONTO}` });
  }

  if (num_cuotas < 1 || num_cuotas > MAX_CUOTAS) {
    return res.status(400).json({ error: `Número de cuotas debe estar entre 1 y ${MAX_CUOTAS}` });
  }

  try {
    const [clientes] = await pool.query('SELECT * FROM cliente WHERE id = ?', [cliente_id]);
    if (clientes.length === 0) {
      return res.status(404).json({ error: 'Cliente no encontrado' });
    }

    const [prestamosExistentes] = await pool.query(
      'SELECT p.id FROM prestamo p JOIN cuota c ON p.id = c.prestamo_id WHERE p.cliente_id = ? AND c.pagada = 0 LIMIT 1',
      [cliente_id]
    );
    if (prestamosExistentes.length > 0) {
      return res.status(400).json({ error: 'El cliente ya tiene un préstamo activo' });
    }

    const [prestamoResult] = await pool.query(
      'INSERT INTO prestamo (cliente_id, monto_total, fecha_inicio) VALUES (?, ?, CURDATE())',
      [cliente_id, monto_total]
    );
    const prestamo_id = prestamoResult.insertId;

    const monto_cuota = Number((monto_total / num_cuotas).toFixed(2));
    let fecha = new Date();

    const cuotasCreadas = [];

    for (let i = 1; i <= num_cuotas; i++) {
      fecha.setDate(fecha.getDate() + 30);
      const fecha_vencimiento = fecha.toISOString().split('T')[0];

      const [cuotaResult] = await pool.query(
        'INSERT INTO cuota (prestamo_id, numero_cuota, fecha_vencimiento, monto_cuota, saldo_pendiente, pagada) VALUES (?, ?, ?, ?, ?, 0)',
        [prestamo_id, i, fecha_vencimiento, monto_cuota, monto_cuota]
      );

      cuotasCreadas.push({
        cuota_id: cuotaResult.insertId,
        numero_cuota: i,
        fecha_vencimiento,
        monto_cuota,
        saldo_pendiente: monto_cuota
      });
    }

    res.json({
      prestamo_id,
      cliente_id,
      monto_total,
      num_cuotas,
      monto_por_cuota: monto_cuota,
      cronograma: cuotasCreadas
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// GET /prestamos/cliente/:cliente_id - ver préstamo + cronograma + email cliente
router.get('/cliente/:cliente_id', async (req, res) => {
  try {
    const cliente_id = req.params.cliente_id;

    const [rows] = await pool.query(
      `SELECT p.*, c.nombre AS cliente_nombre, c.email AS cliente_email
       FROM prestamo p
       JOIN cliente c ON c.id = p.cliente_id
       WHERE p.cliente_id = ?
       LIMIT 1`,
      [cliente_id]
    );

    if (!rows.length) {
      return res.status(404).json({ error: 'El cliente no tiene préstamo' });
    }

    const prestamo = rows[0];

    const [cuotas] = await pool.query(
      'SELECT * FROM cuota WHERE prestamo_id = ? ORDER BY numero_cuota',
      [prestamo.id]
    );

    res.json({
      prestamo,
      cuotas
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;