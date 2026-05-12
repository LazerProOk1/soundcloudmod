import { useTranslation } from 'react-i18next';

export function Discover() {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col items-center justify-center h-full text-white/40 gap-3 select-none">
      <p className="text-lg font-semibold">{t('nav.discover')}</p>
    </div>
  );
}
