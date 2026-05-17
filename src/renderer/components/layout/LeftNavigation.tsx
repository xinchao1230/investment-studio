import React, { useEffect, useCallback } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { MessageSquare, LayoutDashboard } from 'lucide-react';
import { useLayout } from './LayoutProvider';
import { AuthData } from '../../types/authTypes';
import NavigationSection from './NavigationSection';
import UserSection from './UserSection';
import { useDirtyEditors } from '../../contexts/DirtyEditorsContext';
import '../../styles/LeftNavigation.css';

interface LeftNavigationProps {
  authData: AuthData | null;
  onNewChat?: () => void;
  onLogout: () => void;
  onUserMenuToggle: () => void;
  isUserMenuOpen: boolean;
  onNewAgent: () => void;
  onAgentMenuToggle: (chatId: string, buttonElement: HTMLElement) => void;
  openMenuChatId: string | null;
  onChatSessionMenuToggle?: (
    chatId: string,
    sessionId: string,
    title: string,  // 🔥 New: ChatSession title
    buttonElement: HTMLElement,
  ) => void;
  openMenuChatSessionId?: string | null;
}

const LeftNavigation: React.FC<LeftNavigationProps> = ({
  authData,
  onNewChat,
  onLogout,
  onUserMenuToggle,
  isUserMenuOpen,
  onNewAgent,
  onAgentMenuToggle,
  openMenuChatId,
  onChatSessionMenuToggle,
  openMenuChatSessionId,
}) => {
  const { leftPanelCollapsed } = useLayout();
  const location = useLocation();
  const navigate = useNavigate();
  const { hasAnyDirty } = useDirtyEditors();
  const isChat = location.pathname.startsWith('/agent');
  const isResearch = location.pathname.startsWith('/research');

  // Wrap navigate() so any unsaved-editor state pops a confirm before
  // the route change actually unmounts ContentTabs (which would drop
  // Monaco buffers without warning otherwise).
  const guardedNavigate = useCallback(
    (to: string) => {
      if (location.pathname === to) return;
      if (hasAnyDirty()) {
        const ok = window.confirm('有未保存的修改，确定离开当前页面？修改将丢失。');
        if (!ok) return;
      }
      navigate(to);
    },
    [navigate, hasAnyDirty, location.pathname],
  );

  const navigationClasses = [
    'left-navigation',
    leftPanelCollapsed ? 'collapsed' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <nav
      className={navigationClasses}
      role="navigation"
      aria-label="Main navigation"
    >
      <div className="left-nav-mode-switch">
        <button
          type="button"
          className={`mode-btn ${isChat ? 'active' : ''}`}
          title="Chat"
          onClick={() => guardedNavigate('/agent')}
        >
          <MessageSquare size={18} />
        </button>
        <button
          type="button"
          className={`mode-btn ${isResearch ? 'active' : ''}`}
          title="Workspace"
          onClick={() => guardedNavigate('/research')}
        >
          <LayoutDashboard size={18} />
        </button>
      </div>

      {/* Navigation Section - includes AgentList, New Agent button, Divider, and Function List */}
      <NavigationSection
        onNewAgent={onNewAgent}
        onAgentMenuToggle={onAgentMenuToggle}
        openMenuChatId={openMenuChatId}
        onChatSessionMenuToggle={onChatSessionMenuToggle}
        openMenuChatSessionId={openMenuChatSessionId}
      />

      {/* User Section */}
      <UserSection
        authData={authData}
        onLogout={onLogout}
        onUserMenuToggle={onUserMenuToggle}
        isUserMenuOpen={isUserMenuOpen}
      />
    </nav>
  );
};

export default LeftNavigation;
