'use client';

import { useAuth } from '@/components/providers/AuthProvider';
import { useTheme } from '@/components/providers/ThemeProvider';
import { Moon, Sun, Monitor } from 'lucide-react';
import { cn } from '@/lib/utils';

export default function SettingsPage() {
  const { user } = useAuth();
  const { theme, setTheme } = useTheme();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Settings</h1>
        <p className="text-muted-foreground">Manage your preferences</p>
      </div>

      <div className="space-y-6">
        {/* Appearance */}
        <div className="rounded-lg border bg-card p-6">
          <h2 className="text-lg font-semibold">Appearance</h2>
          <p className="text-sm text-muted-foreground">Choose your preferred theme</p>
          <div className="mt-4 grid grid-cols-3 gap-4">
            <ThemeOption
              label="Light"
              icon={<Sun className="h-5 w-5" />}
              active={theme === 'light'}
              onClick={() => setTheme('light')}
            />
            <ThemeOption
              label="Dark"
              icon={<Moon className="h-5 w-5" />}
              active={theme === 'dark'}
              onClick={() => setTheme('dark')}
            />
            <ThemeOption
              label="System"
              icon={<Monitor className="h-5 w-5" />}
              active={theme === 'system'}
              onClick={() => setTheme('system')}
            />
          </div>
        </div>

        {/* Account */}
        <div className="rounded-lg border bg-card p-6">
          <h2 className="text-lg font-semibold">Account</h2>
          <div className="mt-4 space-y-4">
            <div className="flex justify-between py-2">
              <span className="text-muted-foreground">Username</span>
              <span className="font-medium">{user?.username}</span>
            </div>
            <div className="flex justify-between py-2">
              <span className="text-muted-foreground">Email</span>
              <span className="font-medium">{user?.email}</span>
            </div>
            <div className="flex justify-between py-2">
              <span className="text-muted-foreground">Role</span>
              <span className="font-medium capitalize">{user?.role}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function ThemeOption({
  label,
  icon,
  active,
  onClick,
}: {
  label: string;
  icon: React.ReactNode;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'flex flex-col items-center gap-2 rounded-md border p-4 transition-colors',
        active ? 'border-primary bg-primary/5' : 'hover:bg-muted'
      )}
    >
      {icon}
      <span className="text-sm font-medium">{label}</span>
    </button>
  );
}
