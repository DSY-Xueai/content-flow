export function formatBeijingTime(value?: string | null): string {
  if (!value) {
    return '时间未知';
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '时间未知';
  }

  const parts = new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).formatToParts(date);

  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? '';

  return `${get('month')}/${get('day')} ${get('hour')}:${get('minute')}`;
}
