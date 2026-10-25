import { allowedOrigins } from '../src/app.setup.js';

describe('allowedOrigins', () => {
  it.each([[undefined], [''], ['   '], [' , '], [',,,']])('libera qualquer origem quando CORS_ORIGIN é %j', (value) => {
    expect(allowedOrigins(value)).toBe(true);
  });

  it('separa as origens por vírgula, aparando espaços', () => {
    expect(allowedOrigins('a, b')).toEqual(['a', 'b']);
    expect(allowedOrigins(' http://localhost:5173 ,https://app.empresa.com.br ')).toEqual([
      'http://localhost:5173',
      'https://app.empresa.com.br',
    ]);
  });

  it('aceita uma única origem', () => {
    expect(allowedOrigins('http://localhost:5173')).toEqual(['http://localhost:5173']);
  });

  it('descarta entradas vazias entre vírgulas', () => {
    expect(allowedOrigins(',a,, ,b,')).toEqual(['a', 'b']);
  });
});
