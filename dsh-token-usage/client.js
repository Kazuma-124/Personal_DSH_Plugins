window.__ModuleLoader__.load({ id: 'dsh-token-usage', factory: require => {
  const React = require('react');
  function Page() { return React.createElement('iframe', { src: new URL('token-usage', document.baseURI).href, title: 'Token 用量统计', style: { width: '100%', height: '100%', border: 0, display: 'block', background: 'transparent' } }); }
  function Icon({ size = 20 }) { return React.createElement('svg', { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, 'aria-hidden': true }, React.createElement('path', { d: 'M4 3v17h17M8 15l4-5 4 2 5-7' })); }
  return { inject: ['slots', 'layout'], apply(ctx) {
    ctx.effect(() => ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: 'token-usage' }, Page)), 'token-usage: main panel');
    ctx.effect(() => ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({ name: 'sidebar.panellist', id: 'token-usage', order: 10, label: () => 'Token 用量' }, Icon)), 'token-usage: navigation');
  } };
} });
