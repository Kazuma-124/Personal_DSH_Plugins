// Browser half: one control on every plugin page of the Plugins manager that
// reveals the package directory in the host's file manager.
window.__ModuleLoader__.load({
  id: '@kazuma-124/dsh-plugin-actions',
  factory(require) {
    const React = require('react');
    const h = React.createElement;
    const NS = '@kazuma-124/dsh-plugin-actions';
    const dictionaries = {
      zh: {
        reveal: '打开所在文件夹',
        opening: '正在打开…',
        failed: '无法打开该插件的文件夹。内置插件没有可打开的目录。',
      },
      en: {
        reveal: 'Open containing folder',
        opening: 'Opening…',
        failed: 'Could not open this plugin folder. Built-in plugins have no folder to open.',
      },
    };

    const style = {
      display: 'inline-flex',
      alignItems: 'center',
      gap: 8,
      flexWrap: 'wrap',
    };
    const button = {
      font: 'inherit',
      fontSize: 13,
      lineHeight: 1.4,
      color: 'var(--dsw-alias-label-primary)',
      background: 'var(--dsw-alias-bg-layer-2)',
      border: '1px solid var(--dsw-alias-border-l3)',
      borderRadius: 6,
      padding: '4px 10px',
      cursor: 'pointer',
    };
    const note = {
      fontSize: 12,
      lineHeight: 1.5,
      color: 'var(--dsw-alias-label-secondary)',
    };

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        ctx.effect(() => {
          const disposed = { current: false };
          const disposeLocale = ctx.locale.register(NS, dictionaries);
          const boundT = ctx.locale.bind(NS);

          function Actions(props) {
            const t = props.t ?? boundT;
            const subject = props.subject;
            const pkg = subject && (subject.kind === 'bundle' || subject.kind === 'row') ? subject.pkg : null;
            const [state, setState] = React.useState('idle');
            if (!pkg) return null;
            const reveal = async () => {
              setState('opening');
              try {
                const response = await window.fetch('/api/plugin-actions/reveal', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ packageName: pkg.name }),
                  cache: 'no-store',
                  signal: AbortSignal.timeout(15000),
                });
                if (!response.ok) throw new Error('reveal failed');
                if (!disposed.current) setState('done');
              } catch {
                if (!disposed.current) setState('failed');
              }
            };
            return h('div', { style },
              h('button', {
                type: 'button',
                style: { ...button, opacity: state === 'opening' ? 0.6 : 1 },
                disabled: state === 'opening',
                onClick: reveal,
              }, state === 'opening' ? t('opening') : t('reveal')),
              state === 'failed' && h('span', { style: note, role: 'status' }, t('failed')));
          }

          const disposeActions = ctx.slots.inject('plugins.detail.actions', () => ctx.slots.register({
            name: 'plugins.detail.actions',
            id: 'plugin-actions-reveal',
            order: 20,
            locale: NS,
          }, Actions));

          return () => {
            disposed.current = true;
            disposeActions();
            disposeLocale();
          };
        });
      },
    };
  },
});
