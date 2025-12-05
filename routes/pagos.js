const express = require('express');
const pool = require('../db/mysql');
const { aplicarRedondeo } = require('../services/pagoService');
const { calcularMora, esVencida } = require('../services/moraService');
const { enviarComprobanteEmail } = require('../services/emailService');

const router = express.Router();

// Verificar si existe una caja ABIERTA (última sesión no cerrada)
async function cajaAbiertaHoy() {
  const [rows] = await pool.query(
    'SELECT * FROM cierre_caja ORDER BY id DESC LIMIT 1'
  );
  if (rows.length === 0) return false;
  const caja = rows[0];
  return caja.cerrado === 0;
}

// POST /pagos
router.post('/', async (req, res) => {
  const { cuota_id, monto_pagado, medio_pago, canal_comprobante, email } = req.body;

  console.log('BODY PAGO:', req.body);

  if (!cuota_id || !monto_pagado || !medio_pago) {
    return res.status(400).json({ error: 'cuota_id, monto_pagado y medio_pago son obligatorios' });
  }

  try {
    const abierta = await cajaAbiertaHoy();
    if (!abierta) {
      return res.status(400).json({
        error: 'No se puede registrar pagos: la caja actual no está abierta'
      });
    }
  } catch (err) {
    return res.status(500).json({ error: 'Error verificando estado de caja' });
  }

  try {
    const [cuotas] = await pool.query('SELECT * FROM cuota WHERE id = ?', [cuota_id]);
    const cuota = cuotas[0];
    if (!cuota) return res.status(404).json({ error: 'Cuota no encontrada' });

    const vencida = esVencida(cuota.fecha_vencimiento);
    const mora = calcularMora(cuota.saldo_pendiente, vencida);
    const total_debido = cuota.saldo_pendiente + mora;

    if (monto_pagado > total_debido) {
      return res.status(400).json({
        error: 'El monto pagado no puede ser mayor al total debido',
        total_debido
      });
    }

    const { montoCobrar, ajuste } = aplicarRedondeo(monto_pagado, medio_pago);

    const [pagoResult] = await pool.query(
      'INSERT INTO pago (cuota_id, fecha_pago, monto_pagado, medio_pago, redondeo_ajuste) VALUES (?, NOW(), ?, ?, ?)',
      [cuota_id, montoCobrar, medio_pago, ajuste]
    );
    const pago_id = pagoResult.insertId;

    const nuevo_saldo = Math.max(0, Number((cuota.saldo_pendiente - montoCobrar).toFixed(2)));
    const pagada = nuevo_saldo <= 0 ? 1 : 0;

    await pool.query(
      'UPDATE cuota SET saldo_pendiente = ?, pagada = ? WHERE id = ?',
      [nuevo_saldo, pagada, cuota_id]
    );

    const [clienteData] = await pool.query(
      `SELECT c.* FROM cliente c
       JOIN prestamo p ON c.id = p.cliente_id
       JOIN cuota cu ON p.id = cu.prestamo_id
       WHERE cu.id = ?`,
      [cuota_id]
    );
    const cliente = clienteData[0];

    const serie = 'F001';
    const numero = String(pago_id).padStart(8, '0');

    await pool.query(
      `INSERT INTO comprobante (pago_id, serie, numero, cliente_nombre, concepto, total_pagado, enviado_por)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        pago_id,
        serie,
        numero,
        cliente.nombre,
        `Pago cuota ${cuota.numero_cuota}`,
        montoCobrar,
        canal_comprobante || 'EMAIL'
      ]
    );

    const detallesPago = {
      medio_pago,
      nuevo_saldo,
      es_pago_parcial: pagada === 0
    };

    console.log('CANAL:', canal_comprobante, 'EMAIL:', email);

    let email_resultado = null;
    if (canal_comprobante === 'EMAIL' && email) {
      email_resultado = await enviarComprobanteEmail(
        email,
        { serie, numero },
        montoCobrar,
        { nombre: cliente.nombre, documento: cliente.documento },
        detallesPago
      );
    }

    res.json({
      pago_id,
      cuota_id,
      mora_calculada: mora,
      total_debido,
      monto_pagado_solicitado: monto_pagado,
      monto_cobrado: montoCobrar,
      redondeo_ajuste: ajuste,
      nuevo_saldo,
      cuota_pagada: pagada === 1,
      es_pago_parcial: pagada === 0,
      medio_pago,
      canal_comprobante: canal_comprobante || null,
      email_destino: email || null,
      comprobante: { serie, numero },
      email_resultado
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// GET /pagos/historial/:cuota_id
router.get('/historial/:cuota_id', async (req, res) => {
  try {
    const [pagos] = await pool.query(
      'SELECT * FROM pago WHERE cuota_id = ? ORDER BY fecha_pago DESC',
      [req.params.cuota_id]
    );
    res.json(pagos);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;