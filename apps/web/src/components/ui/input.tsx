import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';
export function Input({ className, ...props }: ComponentProps<'input'>) { return <input data-slot="input" className={cn('flex h-11 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-base shadow-xs outline-none placeholder:text-slate-400 focus-visible:border-teal-600 focus-visible:ring-2 focus-visible:ring-teal-100 disabled:opacity-50', className)} {...props}/>; }
