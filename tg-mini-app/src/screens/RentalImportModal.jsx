import React, { useState } from 'react';
import { X, Trash2 } from 'lucide-react';

const btnCancel = { background: 'var(--mc-surface)', color: 'var(--mc-muted)', border: '1px solid var(--mc-border)' };
const fmtNum = (n) => (Number(n) || 0).toLocaleString('ru-RU').replace(/\s/g, ' ');

function Modal({ title, onClose, children }) {
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center" style={{ background: 'rgba(0,0,0,0.4)' }}>
      <div className="w-full max-w-2xl rounded-t-2xl sm:rounded-2xl p-4 max-h-[90vh] overflow-y-auto" style={{ background: 'var(--mc-bg)' }}>
        <div className="flex justify-between items-center mb-3">
          <h3 className="font-bold text-base">{title}</h3>
          <button onClick={onClose}><X size={20} style={{ color: 'var(--mc-muted)' }} /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function parseEquipmentText(text) {
  const raw = text.split('\n').map(l => l.trimEnd());
  const merged = [];
  for (const line of raw) {
    if (!line.trim()) continue;
    const hasTabs = line.includes('\t');
    const hasSemicolons = line.includes(';');
    if ((hasTabs || hasSemicolons) && merged.length >= 0) {
      merged.push(line.trim());
    } else if (merged.length > 0) {
      merged[merged.length - 1] += ' ' + line.trim();
    } else {
      merged.push(line.trim());
    }
  }
  const results = [];
  for (const line of merged) {
    const cols = line.includes('\t') ? line.split('\t') : line.split(';');
    if (cols.length >= 2 && cols[0].trim()) {
      const type = (cols[0] || '').trim();
      const model = (cols[1] || '').trim();
      const serial = (cols[2] || '').trim();
      const value = parseFloat((cols[3] || '').replace(/\s/g, '').replace(',', '.')) || 0;
      const notes = (cols[4] || '').trim();
      results.push({ type, model, serial_number: serial, residual_value: value, notes });
    }
  }
  return results;
}

export function EquipmentImportModal({ onClose, onCreate }) {
  const [text, setText] = useState('');
  const [parsed, setParsed] = useState([]);
  const [step, setStep] = useState('input');
  const [toast, setToast] = useState('');

  const handleParse = () => {
    const rows = parseEquipmentText(text);
    if (!rows.length) { setToast('Не удалось разобрать. Формат: Вид TAB Модель TAB Серийный TAB Стоимость'); return; }
    setParsed(rows);
    setStep('preview');
    setToast('');
  };

  const handleImport = () => {
    let ok = 0;
    const errors = [];
    for (let i = 0; i < parsed.length; i++) {
      const row = parsed[i];
      const r = onCreate({ type: row.type, model: row.model, serial_number: row.serial_number, residual_value: row.residual_value, notes: row.notes });
      if (r?.ok) ok++;
      else errors.push(`${row.type}: ${r?.error || 'Ошибка'}`);
    }
    if (errors.length > 0) {
      setToast(`Ошибка: ${errors[0]}`);
      setParsed(p => p.filter((_, i) => i >= ok));
      return;
    }
    setToast(`Импортировано: ${ok}`);
    setTimeout(onClose, 800);
  };

  const removeRow = (idx) => setParsed(p => p.filter((_, i) => i !== idx));

  return (
    <Modal title="Массовый импорт оборудования" onClose={onClose}>
      {toast && <div className="mb-3 p-2.5 rounded-lg text-xs font-semibold" style={{ background: toast.startsWith('Ошибка') ? '#FEE2E2' : '#DCFCE7', color: toast.startsWith('Ошибка') ? '#991B1B' : '#166534' }}>{toast}</div>}
      {step === 'input' ? (
        <div className="space-y-3">
          <div className="p-3 rounded-lg text-xs" style={{ background: '#EFF6FF', border: '1px solid #BFDBFE', color: '#1E40AF' }}>
            Вставьте из Excel / Google Sheets. Формат:<br />
            <b>Вид</b> TAB <b>Модель</b> TAB <b>Серийный номер</b> [TAB <b>Стоимость</b>] [TAB <b>Примечание</b>]
          </div>
          <textarea value={text} onChange={e => setText(e.target.value)} rows={10} wrap="off"
            placeholder={"Кофемашина\tDeLonghi ECAM\tSN-12345\t350000\nКофемолка\tMahlkönig EK43\tMK-789\t180000"}
            className="w-full px-3 py-2.5 rounded-lg outline-none text-xs font-mono"
            style={{ border: '1px solid var(--mc-border)', resize: 'vertical', overflowX: 'auto' }} />
          <div className="flex gap-3">
            <button onClick={onClose} className="flex-1 py-2.5 rounded-lg font-semibold text-sm" style={btnCancel}>Отмена</button>
            <button onClick={handleParse} disabled={!text.trim()} className="flex-1 py-2.5 rounded-lg font-semibold text-sm text-white" style={{ background: '#7C3AED' }}>Разобрать</button>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="p-3 rounded-lg text-sm" style={{ background: '#F0FDF4', border: '1px solid #BBF7D0', color: '#166534' }}>
            Единиц оборудования: <b>{parsed.length}</b>
          </div>
          <div className="max-h-60 overflow-y-auto space-y-1.5">
            {parsed.map((row, i) => (
              <div key={i} className="flex items-center gap-2 p-2 rounded-lg text-xs" style={{ background: 'var(--mc-surface)', border: '1px solid var(--mc-border)' }}>
                <div className="flex-1 min-w-0">
                  <b>{row.type}{row.model ? ` · ${row.model}` : ''}</b>
                  <div style={{ color: 'var(--mc-muted)' }}>
                    {row.serial_number && <>S/N: {row.serial_number} · </>}
                    {row.residual_value > 0 ? `${fmtNum(row.residual_value)} тг` : ''}
                    {row.notes ? ` · ${row.notes}` : ''}
                  </div>
                </div>
                <button onClick={() => removeRow(i)} className="p-1 rounded" style={{ color: '#EB5757' }}><Trash2 size={12} /></button>
              </div>
            ))}
          </div>
          <div className="flex gap-3">
            <button onClick={() => setStep('input')} className="flex-1 py-2.5 rounded-lg font-semibold text-sm" style={btnCancel}>Назад</button>
            <button onClick={handleImport} disabled={!parsed.length} className="flex-1 py-2.5 rounded-lg font-semibold text-sm text-white" style={{ background: '#22C55E' }}>Импортировать ({parsed.length})</button>
          </div>
        </div>
      )}
    </Modal>
  );
}
