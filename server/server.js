const { createApp } = require('./app');

const PORT = process.env.PORT || 4173;
const app = createApp();

app.listen(PORT, ()=>{
  console.log(`Атлас Аллодов запущен: http://localhost:${PORT}`);
});
