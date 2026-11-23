import { type PayType, QUANTITY_PAY_TYPES, QUANTITY_PAY_WORDS, type QuantityPayType, isQuantityPayType } from '@stubwise/domain';
import { useState } from 'react';
import { View } from 'react-native';
import { Segmented } from '@/ui/primitives';

/**
 * How a worker is paid: hourly, salary, or per unit of work (mile, load, day,
 * piece). Choosing "Per unit" shows a second row for which unit, and
 * remembers the last one picked if the person flips back and forth.
 */
export function PayTypePicker({ value, onChange, height = 44 }: { value: PayType; onChange: (next: PayType) => void; height?: number }) {
  const perUnit = isQuantityPayType(value);
  const [lastUnit, setLastUnit] = useState<QuantityPayType>(isQuantityPayType(value) ? value : 'mile');
  const pick = (next: PayType): void => {
    if (isQuantityPayType(next)) setLastUnit(next);
    onChange(next);
  };

  return (
    <View style={{ gap: 8 }}>
      <Segmented
        value={perUnit ? 'unit' : value}
        onChange={(next) => pick(next === 'unit' ? lastUnit : next)}
        height={height}
        options={[
          { value: 'hourly', label: 'Hourly' },
          { value: 'salary', label: 'Salary' },
          { value: 'unit', label: 'Per unit' },
        ]}
      />
      {perUnit ? (
        <Segmented
          value={value}
          onChange={pick}
          height={height}
          options={QUANTITY_PAY_TYPES.map((type) => ({ value: type, label: QUANTITY_PAY_WORDS[type].title }))}
        />
      ) : null}
    </View>
  );
}
