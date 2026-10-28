import givance from './givance.js';
import eliteCar from './elite-car.js';

// Fichas de exemplo. Em produção as fichas ficam no banco (tabela negocios);
// estas servem para os testes, a bateria e para cadastrar os primeiros clientes (npm run semear).
export const negocios = { givance, 'elite-car': eliteCar };
