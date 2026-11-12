import { describe, it, expect, beforeEach } from 'vitest';
import { GetMyDashboardUseCase } from '../application/use-cases/get-my-dashboard';
import { SaveMyDashboardUseCase } from '../application/use-cases/save-my-dashboard';
import { saveDashboardSchema } from '../interface/http/validators';
import { InMemoryUserDashboardRepository } from './helpers';

const USER_A = '11111111-1111-4111-8111-111111111111';
const USER_B = '22222222-2222-4222-8222-222222222222';
const ORG_1 = '33333333-3333-4333-8333-333333333333';
const ORG_2 = '44444444-4444-4444-8444-444444444444';

const layout = [
  { i: 'w1', widget: 'billing.sales_today', x: 0, y: 0, w: 4, h: 2 },
  { i: 'w2', widget: 'projects.my_tasks', x: 4, y: 0, w: 8, h: 4, config: { limit: 5, onlyMine: true, view: 'list' } },
];

describe('Tablero de Inicio (casos de uso)', () => {
  let dashboards: InMemoryUserDashboardRepository;
  let getDashboard: GetMyDashboardUseCase;
  let saveDashboard: SaveMyDashboardUseCase;
  const now = new Date('2026-11-12T10:00:00Z');

  beforeEach(() => {
    dashboards = new InMemoryUserDashboardRepository();
    getDashboard = new GetMyDashboardUseCase(dashboards);
    saveDashboard = new SaveMyDashboardUseCase(dashboards, () => now);
  });

  it('sin tablero guardado devuelve layout null', async () => {
    expect(await getDashboard.execute(USER_A, ORG_1)).toEqual({ layout: null });
  });

  it('guarda y luego devuelve lo mismo, con la fecha del reloj', async () => {
    expect(await saveDashboard.execute({ userId: USER_A, organizationId: ORG_1, layout })).toEqual({ layout });
    expect(await getDashboard.execute(USER_A, ORG_1)).toEqual({ layout });
    expect(dashboards.updatedAt(USER_A, ORG_1)).toEqual(now);
  });

  it('un segundo guardado reemplaza el tablero entero', async () => {
    await saveDashboard.execute({ userId: USER_A, organizationId: ORG_1, layout });
    await saveDashboard.execute({ userId: USER_A, organizationId: ORG_1, layout: [layout[0]] });
    expect(await getDashboard.execute(USER_A, ORG_1)).toEqual({ layout: [layout[0]] });
  });

  it('acepta un tablero vacío y lo distingue de nunca guardado', async () => {
    await saveDashboard.execute({ userId: USER_A, organizationId: ORG_1, layout: [] });
    expect(await getDashboard.execute(USER_A, ORG_1)).toEqual({ layout: [] });
  });

  it('otro usuario u otra organización no ven el tablero', async () => {
    await saveDashboard.execute({ userId: USER_A, organizationId: ORG_1, layout });
    expect(await getDashboard.execute(USER_B, ORG_1)).toEqual({ layout: null });
    expect(await getDashboard.execute(USER_A, ORG_2)).toEqual({ layout: null });
  });
});

describe('saveDashboardSchema', () => {
  const item = { i: 'a', widget: 'billing.sales_today', x: 0, y: 0, w: 4, h: 2 };
  const ok = (l: unknown) => saveDashboardSchema.safeParse({ layout: l }).success;
  const many = (n: number) => Array.from({ length: n }, (_, k) => ({ ...item, i: `w${k}` }));

  it('acepta un layout válido', () => {
    expect(ok(layout)).toBe(true);
  });

  it('rechaza tamaños y posiciones fuera de la rejilla', () => {
    expect(ok([{ ...item, w: 13 }])).toBe(false);
    expect(ok([{ ...item, w: 0 }])).toBe(false);
    expect(ok([{ ...item, h: 21 }])).toBe(false);
    expect(ok([{ ...item, x: -1 }])).toBe(false);
    expect(ok([{ ...item, y: 1.5 }])).toBe(false);
  });

  it('rechaza un id de widget con mayúsculas o símbolos', () => {
    expect(ok([{ ...item, widget: 'Billing.Sales' }])).toBe(false);
    expect(ok([{ ...item, widget: 'billing-sales' }])).toBe(false);
  });

  it('rechaza más de 40 widgets y acepta exactamente 40', () => {
    expect(ok(many(40))).toBe(true);
    expect(ok(many(41))).toBe(false);
  });

  it('rechaza ids de ítem repetidos', () => {
    expect(ok([item, { ...item }])).toBe(false);
  });

  it('rechaza config con más de 10 claves o con valores no primitivos', () => {
    const big = Object.fromEntries(Array.from({ length: 11 }, (_, k) => [`k${k}`, k]));
    expect(ok([{ ...item, config: big }])).toBe(false);
    expect(ok([{ ...item, config: { nested: { a: 1 } } }])).toBe(false);
  });

  it('rechaza un layout de más de 16 KB', () => {
    const fat = many(40).map((it) => ({ ...it, config: { a: 'x'.repeat(500) } }));
    expect(ok(fat)).toBe(false);
  });

  it('descarta claves que no son del contrato', () => {
    const parsed = saveDashboardSchema.parse({ layout: [{ ...item, moved: false, static: true }] });
    expect(parsed.layout[0]).toEqual(item);
  });
});
