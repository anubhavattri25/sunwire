function toUtcDate(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Date(date.toISOString());
}

function formatTimeAgo(input) {
  const date = toUtcDate(input);
  if (!date) return 'just now';

  const diffMs = Date.now() - date.getTime();
  const minute = 60 * 1000;
  const hour = 60 * minute;
  const day = 24 * hour;

  if (diffMs < hour) {
    const value = Math.max(1, Math.floor(diffMs / minute));
    return `${value} minute${value === 1 ? '' : 's'} ago`;
  }

  if (diffMs < day) {
    const value = Math.max(1, Math.floor(diffMs / hour));
    return `${value} hour${value === 1 ? '' : 's'} ago`;
  }

  const value = Math.max(1, Math.floor(diffMs / day));
  return `${value} day${value === 1 ? '' : 's'} ago`;
}

module.exports = {
  toUtcDate,
  formatTimeAgo,
};
