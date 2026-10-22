/**
 * Os modulos foram recuperados do JavaScript compilado, onde as anotacoes de
 * tipo genericas foram descartadas. `Object.entries(algoAny)` volta `unknown`
 * para o valor, o que gera centenas de falsos positivos.
 *
 * Estas sobrecargas devolvem `any` e ficam no topo da resolucao por serem
 * declaradas depois das de `lib.es*.d.ts`. E uma muleta temporaria: a medida
 * que os tipos forem restaurados modulo a modulo, este arquivo e removido.
 */
declare global {
    interface ObjectConstructor {
        entries(o: any): [string, any][];
        values(o: any): any[];
        keys(o: any): string[];
        fromEntries(entries: any): any;
    }
}
export {};
