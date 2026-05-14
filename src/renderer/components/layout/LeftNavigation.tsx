import React, { useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { MessageSquare, LayoutDashboard } from 'lucide-react';
import { useLayout } from './LayoutProvider';
import { AuthData } from '../../types/authTypes';
import NavigationSection from './NavigationSection';
import UserSection from './UserSection';
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
  const isChat = location.pathname.startsWith('/agent');
  const isResearch = location.pathname.startsWith('/research');

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
          onClick={() => navigate('/agent')}
        >
          <MessageSquare size={18} />
        </button>
        <button
          type="button"
          className={`mode-btn ${isResearch ? 'active' : ''}`}
          title="Workspace"
          onClick={() => navigate('/research')}
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
