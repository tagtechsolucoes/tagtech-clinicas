'use client';

import { useState } from 'react';
import type { PublicClinic } from '@/lib/api';
import { imagem } from '@/lib/tema';

/** Antes e depois publicados pela clínica, com autorização de imagem do paciente. */
export function Galeria({ itens }: { itens: PublicClinic['gallery'] }) {
  return (
    <div className="grid gap-5 sm:grid-cols-2">
      {itens.map((g) => (
        <Par key={g.id} item={g} />
      ))}
    </div>
  );
}

function Par({ item }: { item: PublicClinic['gallery'][number] }) {
  const [pos, setPos] = useState(50);
  return (
    <figure className="overflow-hidden rounded-3xl bg-folha ring-1 ring-linha">
      <div className="relative aspect-[4/3] select-none">
        <img
          src={imagem(item.afterUrl)}
          alt={`${item.title}: depois`}
          className="absolute inset-0 h-full w-full object-cover"
        />
        <img
          src={imagem(item.beforeUrl)}
          alt={`${item.title}: antes`}
          className="absolute inset-0 h-full w-full object-cover"
          style={{ clipPath: `inset(0 ${100 - pos}% 0 0)` }}
        />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-0 w-0.5 bg-white"
          style={{ left: `${pos}%` }}
        >
          <span className="absolute top-1/2 left-1/2 grid h-9 w-9 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-white text-tinta shadow-lg">
            <svg
              viewBox="0 0 24 24"
              className="h-4 w-4"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              aria-hidden="true"
            >
              <path d="M9 6l-6 6 6 6M15 6l6 6-6 6" />
            </svg>
          </span>
        </div>
        <span className="absolute bottom-3 left-3 rounded-lg bg-tinta/70 px-2 py-0.5 text-xs font-semibold text-white">
          Antes
        </span>
        <span className="absolute right-3 bottom-3 rounded-lg bg-tinta/70 px-2 py-0.5 text-xs font-semibold text-white">
          Depois
        </span>
        <input
          type="range"
          min={0}
          max={100}
          value={pos}
          aria-label={`Comparar antes e depois: ${item.title}`}
          onChange={(e) => setPos(Number(e.target.value))}
          className="absolute inset-0 h-full w-full cursor-ew-resize opacity-0"
        />
      </div>
      <figcaption className="px-5 py-4 font-semibold">{item.title}</figcaption>
    </figure>
  );
}
