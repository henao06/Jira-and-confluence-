/**
 * labels.js — Aplica los textos configurables de la interfaz.
 * Lee window.APP_CONFIG.labels (resuelto por el server desde qa-config.json → "labels",
 * con defaults genéricos). Recorre el DOM y reemplaza el texto de cada elemento marcado
 * con  data-label="clave"  por el valor configurado. Nada de textos quemados: quien baje
 * la app ve el default y lo pisa por el nombre de SU tablero desde el wizard.
 *
 * Uso en el HTML:  <span data-label="finalizeTestCase">Finalizar caso</span>
 * También expone  Labels.get('clave')  para textos generados por JS (tooltips, etc.).
 */
(() => {
  function _labels() { return (window.APP_CONFIG && window.APP_CONFIG.labels) || {}; }

  function get(key, fallback) {
    const v = _labels()[key];
    return (typeof v === 'string' && v.trim()) ? v : (fallback != null ? fallback : '');
  }

  function apply(root) {
    const scope = root || document;
    scope.querySelectorAll('[data-label]').forEach(el => {
      const key = el.getAttribute('data-label');
      const val = get(key, el.textContent);
      if (val !== el.textContent) el.textContent = val;
    });
    scope.querySelectorAll('[data-label-title]').forEach(el => {
      const key = el.getAttribute('data-label-title');
      const val = get(key, el.getAttribute('title'));
      if (val) el.setAttribute('title', val);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => apply());
  } else {
    apply();
  }

  window.Labels = { get, apply };
})();
