import { type Bilingual, dayBefore, divRound, type Item, labelFromInput } from '@cannopy/core';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useParams } from 'react-router';
import { useDocuments, useItem, useItems } from '../data/hooks';
import { newLine, repo } from '../data/repo';
import { useSession } from '../data/session';
import { AmountField, Button, Choice, QuantityField, TextField } from '../ui/fields';
import { formatDate, formatQuantity, today, useLabel, useLanguage, useMoney } from '../ui/format';
import { Row } from '../ui/List';
import { Confirm } from '../ui/Picker';
import { Card, EmptyState, Screen, Section } from '../ui/Screen';
import { useToast } from '../ui/Toast';
import { documentTitle } from './documents';

/** Items and stock: what the owner sells, with quantity, average cost and value from the server's costing. */
export function Items() {
  const { t } = useTranslation();
  const items = useItems();
  const pick = useLabel();
  const money = useMoney();
  const [query, setQuery] = useState('');
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return [...items]
      .sort((a, b) => pick(a.name).localeCompare(pick(b.name)))
      .filter(
        (i) => !q || `${i.name.en} ${i.name.my} ${i.barcode ?? ''}`.toLowerCase().includes(q),
      );
  }, [items, query, pick]);

  return (
    <Screen
      title={t('nav.items')}
      actions={
        <Link to="/items/new" className="button primary small">
          + {t('items.new')}
        </Link>
      }
    >
      {items.length > 6 ? (
        <input
          className="input search"
          placeholder={t('common.search')}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      ) : null}
      {items.length === 0 ? (
        <EmptyState
          title={t('items.empty_title')}
          hint={t('items.empty_hint')}
          action={
            <Link to="/items/new" className="button primary">
              + {t('items.new')}
            </Link>
          }
        />
      ) : (
        <Card className="flush">
          {shown.map((i) => (
            <Row
              key={i.id}
              to={`/items/${i.id}`}
              title={pick(i.name)}
              subtitle={
                i.type === 'stocked'
                  ? `${t('items.in_stock')}: ${formatQuantity(i.quantityOnHandMilli)} ${pick(i.unit)} · ${t('items.value')} ${money(i.stockValue)}`
                  : t(`items.type.${i.type}`)
              }
              right={i.sellingPrice !== null ? money(i.sellingPrice) : undefined}
              rightSub={
                i.type === 'stocked' &&
                i.lowStockLevelMilli !== null &&
                i.quantityOnHandMilli <= i.lowStockLevelMilli
                  ? t('items.low')
                  : undefined
              }
              tone={i.quantityOnHandMilli < 0 ? 'out' : 'neutral'}
            />
          ))}
        </Card>
      )}
    </Screen>
  );
}

const UNITS: Bilingual[] = [
  { en: 'piece', my: 'ခု' },
  { en: 'kg', my: 'ကီလို' },
  { en: 'viss', my: 'ပိဿာ' },
  { en: 'bag', my: 'အိတ်' },
  { en: 'bottle', my: 'ပုလင်း' },
  { en: 'box', my: 'ဘူး' },
  { en: 'dozen', my: 'ဒါဇင်' },
  { en: 'litre', my: 'လီတာ' },
  { en: 'hour', my: 'နာရီ' },
];

export function ItemEdit() {
  const { id } = useParams();
  const item = useItem(id === 'new' ? undefined : id);
  if (id !== 'new' && !item) return null;
  return <ItemForm key={item?.id ?? 'new'} existing={item} />;
}

function ItemForm({ existing }: { existing?: Item | undefined }) {
  const { t } = useTranslation();
  const { business, user } = useSession();
  const navigate = useNavigate();
  const toast = useToast();
  const language = useLanguage();
  const pick = useLabel();
  const money = useMoney();
  const docs = useDocuments();

  const [name, setName] = useState(existing ? pick(existing.name) : '');
  const [type, setType] = useState<Item['type']>(existing?.type ?? 'stocked');
  const [unitIndex, setUnitIndex] = useState(() => {
    const i = UNITS.findIndex((u) => u.en === existing?.unit.en);
    return i >= 0 ? String(i) : existing ? 'custom' : '0';
  });
  const [customUnit, setCustomUnit] = useState(existing ? pick(existing.unit) : '');
  const [price, setPrice] = useState<number | null>(existing?.sellingPrice ?? null);
  const [lowStock, setLowStock] = useState<number | null>(existing?.lowStockLevelMilli ?? null);
  const [openingQty, setOpeningQty] = useState<number | null>(null);
  const [openingCost, setOpeningCost] = useState<number | null>(null);
  const [countQty, setCountQty] = useState<number | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const movements = useMemo(
    () =>
      existing
        ? docs.filter((d) => d.lines.some((l) => l.itemId === existing.id)).slice(0, 10)
        : [],
    [docs, existing],
  );

  const unit: Bilingual =
    unitIndex === 'custom'
      ? labelFromInput(customUnit.trim() || 'piece', language)
      : (UNITS[Number(unitIndex)] ?? UNITS[0]!);

  const submit = async () => {
    if (!name.trim()) return setError(t('items.need_name'));
    setError(null);
    const item: Item = {
      ...(existing ?? repo.newItem(business.id)),
      name: existing
        ? { ...existing.name, [language]: name.trim() }
        : labelFromInput(name.trim(), language),
      type,
      unit,
      sellingPrice: price,
      lowStockLevelMilli: lowStock,
    };
    await repo.saveItem(item);
    if (!existing && type === 'stocked' && openingQty && openingQty > 0) {
      const doc = await repo.newDocument(
        business.id,
        user.id,
        'opening_balance',
        dayBefore(today()),
      );
      const amount = divRound(openingQty * (openingCost ?? 0), 1000);
      doc.lines = [
        newLine({
          itemId: item.id,
          quantityMilli: openingQty,
          unitPrice: openingCost ?? 0,
          amount,
        }),
      ];
      doc.total = amount;
      doc.note = t('setup.opening_note');
      await repo.saveDocument(doc);
    }
    toast(t('items.saved'));
    if (existing) navigate(-1);
    else navigate('/items');
  };

  const count = async () => {
    if (!existing || countQty === null) return;
    const diff = countQty - existing.quantityOnHandMilli;
    if (diff === 0) return toast(t('items.count_same'));
    const doc = await repo.newDocument(business.id, user.id, 'stock_adjustment', today());
    const amount = diff > 0 ? divRound(diff * existing.averageCost, 1000) : 0;
    doc.lines = [
      newLine({
        itemId: existing.id,
        quantityMilli: diff,
        unitPrice: existing.averageCost,
        amount,
      }),
    ];
    doc.total = 0;
    doc.note = t('items.count_note', { qty: formatQuantity(countQty) });
    await repo.saveDocument(doc);
    toast(t('items.count_saved', { diff: formatQuantity(diff) }));
    setCountQty(null);
  };

  const remove = async () => {
    if (!existing) return;
    await repo.deleteItem(existing.id);
    toast(t('items.deleted'));
    navigate('/items', { replace: true });
  };

  return (
    <Screen
      title={existing ? pick(existing.name) : t('items.new')}
      back
      footer={
        <Button full onClick={() => void submit()}>
          {t('common.save')}
        </Button>
      }
    >
      {existing && existing.type === 'stocked' ? (
        <Card className="stat">
          <div className="stat-label">{t('items.in_stock')}</div>
          <div className={`stat-value ${existing.quantityOnHandMilli < 0 ? 'out' : ''}`}>
            {formatQuantity(existing.quantityOnHandMilli)} {pick(existing.unit)}
          </div>
          <div className="muted small">
            {t('items.avg_cost')} {money(existing.averageCost)} · {t('items.value')}{' '}
            {money(existing.stockValue)}
          </div>
        </Card>
      ) : null}
      <Section>
        <TextField label={t('items.name')} value={name} onChange={setName} autoFocus={!existing} />
        <Choice
          label={t('items.type_label')}
          value={type}
          onChange={(v) => setType(v)}
          wrap
          options={[
            {
              value: 'stocked',
              label: t('items.type.stocked'),
              hint: t('items.type.stocked_hint'),
            },
            {
              value: 'not_tracked',
              label: t('items.type.not_tracked'),
              hint: t('items.type.not_tracked_hint'),
            },
            {
              value: 'service',
              label: t('items.type.service'),
              hint: t('items.type.service_hint'),
            },
          ]}
        />
        <Choice
          label={t('items.unit')}
          value={unitIndex}
          onChange={setUnitIndex}
          wrap
          options={[
            ...UNITS.map((u, i) => ({ value: String(i), label: pick(u) })),
            { value: 'custom', label: t('items.unit_other') },
          ]}
        />
        {unitIndex === 'custom' ? (
          <TextField
            value={customUnit}
            onChange={setCustomUnit}
            placeholder={t('items.unit_other')}
          />
        ) : null}
        <AmountField
          label={t('items.selling_price')}
          value={price}
          onChange={setPrice}
          presets={false}
        />
        {type === 'stocked' ? (
          <QuantityField
            label={t('items.low_stock_level')}
            value={lowStock}
            onChange={setLowStock}
            unit={pick(unit)}
          />
        ) : null}
        {!existing && type === 'stocked' ? (
          <Card>
            <h2 className="card-title">{t('items.opening_title')}</h2>
            <p className="muted small">{t('items.opening_hint')}</p>
            <QuantityField
              label={t('items.opening_qty')}
              value={openingQty}
              onChange={setOpeningQty}
              unit={pick(unit)}
            />
            <AmountField
              label={t('items.opening_cost')}
              value={openingCost}
              onChange={setOpeningCost}
              presets={false}
            />
          </Card>
        ) : null}
        {error ? <div className="banner warn">{error}</div> : null}
      </Section>

      {existing && existing.type === 'stocked' ? (
        <Section title={t('items.count_title')}>
          <Card>
            <p className="muted small">{t('items.count_hint')}</p>
            <QuantityField
              label={t('items.counted')}
              value={countQty}
              onChange={setCountQty}
              unit={pick(existing.unit)}
            />
            {countQty !== null ? (
              <div className="muted small">
                {t('items.count_diff', {
                  diff: formatQuantity(countQty - existing.quantityOnHandMilli),
                })}
              </div>
            ) : null}
            <Button kind="secondary" onClick={() => void count()} disabled={countQty === null}>
              {t('items.count_save')}
            </Button>
          </Card>
        </Section>
      ) : null}

      {movements.length > 0 ? (
        <Section title={t('items.recent')}>
          <Card className="flush">
            {movements.map((d) => {
              const line = d.lines.find((l) => l.itemId === existing?.id);
              return (
                <Row
                  key={d.id}
                  to={`/documents/${d.id}`}
                  title={documentTitle(d, t)}
                  subtitle={formatDate(d.date, language)}
                  right={
                    line
                      ? `${d.type === 'sale' ? '−' : ''}${formatQuantity(Math.abs(line.quantityMilli))}`
                      : ''
                  }
                />
              );
            })}
          </Card>
        </Section>
      ) : null}

      {existing ? (
        <Section>
          <Button kind="danger" onClick={() => setConfirmDelete(true)}>
            {t('items.delete')}
          </Button>
          <Confirm
            open={confirmDelete}
            title={t('items.delete')}
            text={t('items.delete_hint')}
            confirmLabel={t('common.delete')}
            danger
            onConfirm={() => void remove()}
            onClose={() => setConfirmDelete(false)}
          />
        </Section>
      ) : null}
    </Screen>
  );
}
