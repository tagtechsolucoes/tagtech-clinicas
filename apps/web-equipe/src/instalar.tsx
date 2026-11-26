import { useEffect, useState, useSyncExternalStore } from 'react';

/** O evento que o Chrome e o Edge (Windows, macOS, Linux, Android) mandam quando dá para instalar. */
interface PedidoDeInstalacao extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

let pedido: PedidoDeInstalacao | null = null;
const ouvintes = new Set<() => void>();
const avisar = () => ouvintes.forEach((f) => f());

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    pedido = e as PedidoDeInstalacao;
    avisar();
  });
  window.addEventListener('appinstalled', () => {
    pedido = null;
    avisar();
  });
}

/** Registra o service worker (só no build de produção, para não atrapalhar o desenvolvimento). */
export function registrarApp() {
  if (import.meta.env.PROD && 'serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js').catch(() => undefined);
    });
  }
}

const jaInstalado = () =>
  window.matchMedia('(display-mode: standalone)').matches ||
  (navigator as Navigator & { standalone?: boolean }).standalone === true;

/** Safari não tem botão de instalar: a pessoa usa o menu. */
function dicaDoNavegador(): string | null {
  const ua = navigator.userAgent;
  const safari = /Safari/.test(ua) && !/Chrome|Chromium|CriOS|Edg|OPR|Firefox|FxiOS/.test(ua);
  if (/iPhone|iPad|iPod/.test(ua))
    return 'No iPhone ou iPad: toque em Compartilhar e depois em “Adicionar à Tela de Início”.';
  if (safari && /Macintosh/.test(ua)) return 'No Safari do Mac: menu Arquivo › Adicionar ao Dock.';
  if (/Firefox/.test(ua))
    return 'O Firefox não instala apps. Abra no Chrome ou no Edge e use o botão Instalar.';
  return null;
}

/**
 * Botão "Instalar o app": no Chrome e no Edge abre a instalação (vira app no Windows, macOS
 * e Linux, com ícone próprio e janela sem barra do navegador). No Safari, mostra o caminho
 * pelo menu. Some quando o app já está instalado.
 */
export function InstalarApp({
  className,
  dicaClassName,
}: {
  className: string;
  dicaClassName: string;
}) {
  const disponivel = useSyncExternalStore(
    (f) => {
      ouvintes.add(f);
      return () => ouvintes.delete(f);
    },
    () => pedido !== null,
  );
  const [instalado, setInstalado] = useState(false);
  const [dica, setDica] = useState<string | null>(null);
  const [mostrarDica, setMostrarDica] = useState(false);

  useEffect(() => {
    setInstalado(jaInstalado());
    setDica(dicaDoNavegador());
  }, []);

  if (instalado || (!disponivel && !dica)) return null;

  async function instalar() {
    if (pedido) {
      await pedido.prompt();
      const { outcome } = await pedido.userChoice;
      if (outcome === 'accepted') {
        pedido = null;
        avisar();
        setInstalado(true);
      }
    } else setMostrarDica((v) => !v);
  }

  return (
    <div>
      <button
        type="button"
        onClick={() => void instalar()}
        className={className}
        aria-expanded={pedido ? undefined : mostrarDica}
      >
        <svg
          viewBox="0 0 20 20"
          className="h-4 w-4 shrink-0"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          aria-hidden="true"
        >
          <path
            d="M10 3v9m0 0l-3.5-3.5M10 12l3.5-3.5M4 14.5V16a1 1 0 001 1h10a1 1 0 001-1v-1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        Instalar o app
      </button>
      {mostrarDica && dica ? (
        <p role="status" className={dicaClassName}>
          {dica}
        </p>
      ) : null}
    </div>
  );
}
