'use client';

import { useAuth } from '@/components/providers/AuthProvider';
import { User } from 'lucide-react';

export function Navbar() {
  const { user } = useAuth();

  return (
    <header className="sticky top-0 z-20 flex h-16 items-center border-b bg-background/80 px-6 backdrop-blur lg:ml-64">
      <div className="flex flex-1 items-center justify-end gap-4">
        {user ? (
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-primary-foreground">
              <User className="h-4 w-4" />
            </div>
            <div className="hidden text-sm md:block">
              <p className="font-medium">{user.username}</p>
              <p className="text-xs text-muted-foreground capitalize">{user.role}</p>
            </div>
          </div>
        ) : (
          <span className="text-sm text-muted-foreground">Guest</span>
        )}
      </div>
    </header>
  );
}
