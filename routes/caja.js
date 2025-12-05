const express = require('express');
const pool = require('../db/mysql');

const router = express.Router();

// Obtener última sesión de caja
async function obtenerUltimaCaja() {
  const [rows] = await pool.query(
    'SELECT * FROM cierre_caja ORDER BY id DESC LIMIT 1'
  );
  return rows.length ? rows[0] : null;
}

// POST /caja/apertura
router.post('/apertura', async (req, res) => {
  const { monto_inicial } = req.body;
  if (monto_inicial == null) {
    return res.status(400).json({ error: 'monto_inicial es obligatorio' });
  }

  try {
    const ultima = await obtenerUltimaCaja();

    if (ultima && ultima.cerrado === 0) {
      return res.status(400).json({ error: 'Ya hay una caja abierta, debe cerrarse antes de abrir otra' });
    }

    const [result] = await pool.query(
      'INSERT INTO cierre_caja (fecha, monto_inicial) VALUES (NOW(), ?)',
      [monto_inicial]
    );

    res.json({
      id: result.insertId,
      fecha_apertura: new Date().toISOString(),
      monto_inicial: Number(monto_inicial)
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /caja/resumen-actual
router.get('/resumen-actual', async (req, res) => {
  try {
    const ultima = await obtenerUltimaCaja();
    if (!ultima) {
      return res.status(404).json({ error: 'No existe ninguna sesión de caja' });
    }
    if (ultima.cerrado === 1) {
      return res.status(400).json({ error: 'La última caja ya está cerrada' });
    }

    const [pagos] = await pool.query(
      `SELECT medio_pago, SUM(monto_pagado) AS total
       FROM pago
       WHERE fecha_pago >= ?
       GROUP BY medio_pago`,
      [ultima.fecha]
    );

    let total_efectivo = 0, total_tarjeta = 0, total_yape = 0, total_plin = 0;

    pagos.forEach(p => {
      if (p.medio_pago === 'EFECTIVO') total_efectivo = Number(p.total);
      if (p.medio_pago === 'TARJETA') total_tarjeta = Number(p.total);
      if (p.medio_pago === 'YAPE') total_yape = Number(p.total);
      if (p.medio_pago === 'PLIN') total_plin = Number(p.total);
    });

    const monto_inicial_num = Number(ultima.monto_inicial);
    const total_teorico = Number((
      monto_inicial_num +
      total_efectivo +
      total_tarjeta +
      total_yape +
      total_plin
    ).toFixed(2));

    res.json({
      caja_id: ultima.id,
      fecha_apertura: ultima.fecha,
      monto_inicial: monto_inicial_num,
      total_efectivo,
      total_tarjeta,
      total_yape,
      total_plin,
      total_teorico
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /caja/cierre
router.post('/cierre', async (req, res) => {
  const { total_real } = req.body;

  if (total_real == null) {
    return res.status(400).json({ error: 'total_real es obligatorio' });
  }

  try {
    const ultima = await obtenerUltimaCaja();
    if (!ultima) {
      return res.status(404).json({ error: 'No existe ninguna sesión de caja para cerrar' });
    }
    if (ultima.cerrado === 1) {
      return res.status(400).json({ error: 'La última caja ya está cerrada' });
    }

    const [pagos] = await pool.query(
      `SELECT medio_pago, SUM(monto_pagado) AS total
       FROM pago
       WHERE fecha_pago >= ?
       GROUP BY medio_pago`,
      [ultima.fecha]
    );

    let total_efectivo = 0, total_tarjeta = 0, total_yape = 0, total_plin = 0;

    pagos.forEach(p => {
      if (p.medio_pago === 'EFECTIVO') total_efectivo = Number(p.total);
      if (p.medio_pago === 'TARJETA') total_tarjeta = Number(p.total);
      if (p.medio_pago === 'YAPE') total_yape = Number(p.total);
      if (p.medio_pago === 'PLIN') total_plin = Number(p.total);
    });

    const monto_inicial_num = Number(ultima.monto_inicial);
    const total_teorico = Number((
      monto_inicial_num +
      total_efectivo +
      total_tarjeta +
      total_yape +
      total_plin
    ).toFixed(2));

    const total_real_num = Number(total_real);
    const diferencia = Number((total_real_num - total_teorico).toFixed(2));

    if (diferencia !== 0) {
      return res.status(400).json({
        error: 'La caja no cuadra, no se puede cerrar',
        total_teorico,
        total_real: total_real_num,
        diferencia
      });
    }

    await pool.query(
      `UPDATE cierre_caja
       SET total_efectivo = ?, total_tarjeta = ?, total_yape = ?, total_plin = ?,
           total_teorico = ?, total_real = ?, diferencia = ?, cerrado = 1, fecha_cierre = NOW()
       WHERE id = ?`,
      [
        total_efectivo,
        total_tarjeta,
        total_yape,
        total_plin,
        total_teorico,
        total_real_num,
        diferencia,
        ultima.id
      ]
    );

    res.json({
      mensaje: 'Caja cerrada correctamente',
      caja_id: ultima.id,
      total_teorico,
      total_real: total_real_num,
      diferencia
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;