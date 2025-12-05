require('dotenv').config();
const express = require('express');
const cors = require('cors');
const app = express();

const clientesRoutes = require('./routes/clientes');
const prestamosRoutes = require('./routes/prestamos');
const pagosRoutes = require('./routes/pagos');
const cajaRoutes = require('./routes/caja');

app.use(cors());
app.use(express.json());

app.use('/clientes', clientesRoutes);
app.use('/prestamos', prestamosRoutes);
app.use('/pagos', pagosRoutes);
app.use('/caja', cajaRoutes);

console.log('ENV MYSQLHOST:', process.env.MYSQLHOST);
console.log('ENV MYSQLPORT:', process.env.MYSQLPORT);

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`API escuchando en puerto ${PORT}`);
});
