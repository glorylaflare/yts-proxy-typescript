/** Log com horário local (pt-BR), usado para acompanhar buscas no terminal. */
export function log(...args: unknown[]): void {
  console.log(new Date().toLocaleTimeString("pt-BR"), ...args);
}
