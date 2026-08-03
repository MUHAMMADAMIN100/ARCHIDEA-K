/** Плавный скролл к секции по id с учётом фиксированной шапки (+ sticky bar на mobile). */
export function scrollToId(id: string, offset = 72) {
  const el = document.getElementById(id);
  if (!el) return;
  const top = el.getBoundingClientRect().top + window.scrollY - offset;
  window.scrollTo({ top, behavior: 'smooth' });
}
