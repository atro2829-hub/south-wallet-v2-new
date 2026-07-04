'use client';

import { motion } from 'framer-motion';
import { Gamepad2, Gift, Star, ArrowRight } from 'lucide-react';
import { useAppStore } from '@/lib/store';

export function EntertainmentScreen() {
  const { setActiveScreen } = useAppStore();

  const subSections = [
    { id: 'games', label: 'الألعاب', desc: 'شحن جميع الألعاب', icon: Gamepad2, color: '#8B5CF6' },
    { id: 'gift-cards', label: 'بطاقات وأكواد', desc: 'بطاقات هدايا وأكواد', icon: Gift, color: '#EC4899' },
    { id: 'favorites', label: 'المفضلة', desc: 'خدماتك المفضلة', icon: Star, color: '#F59E0B' },
  ];

  return (
    <div className="min-h-screen bg-background pb-20" style={{ direction: 'rtl' }}>
      {/* Header */}
      <div className="sticky top-0 z-30 bg-background/95 backdrop-blur-lg border-b" style={{ borderColor: 'rgba(0,0,0,0.06)' }}>
        <div className="flex items-center justify-between px-4 py-3">
          <button onClick={() => setActiveScreen('main')} className="p-2 -mr-2">
            <ArrowRight size={22} />
          </button>
          <h1 className="text-lg font-bold">الخدمات الترفيهية</h1>
          <div className="w-8" />
        </div>
      </div>

      {/* Sub-sections */}
      <div className="p-4 space-y-3">
        {subSections.map((sub, i) => {
          const Icon = sub.icon;
          return (
            <motion.button
              key={sub.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.05 }}
              onClick={() => setActiveScreen(sub.id)}
              className="w-full flex items-center gap-4 p-4 rounded-2xl border"
              style={{
                background: 'rgba(255,255,255,0.6)',
                borderColor: 'rgba(0,0,0,0.06)',
              }}
            >
              <div
                className="w-14 h-14 rounded-2xl flex items-center justify-center"
                style={{ background: `${sub.color}15` }}
              >
                <Icon size={28} color={sub.color} />
              </div>
              <div className="flex-1 text-right">
                <h3 className="text-base font-bold">{sub.label}</h3>
                <p className="text-xs text-muted-foreground">{sub.desc}</p>
              </div>
              <ArrowRight size={20} className="opacity-30" style={{ transform: 'scaleX(-1)' }} />
            </motion.button>
          );
        })}
      </div>
    </div>
  );
}
