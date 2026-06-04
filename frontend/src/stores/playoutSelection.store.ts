import { create } from 'zustand'

interface PlayoutSelectionState {
  // itemId selecionado por canal — null = nenhum selecionado
  selectedByChannel: Record<string, string | null>
  setSelected: (channelId: string, itemId: string | null) => void
  clearSelected: (channelId: string) => void
  // clipId do item selecionado — espelhado na biblioteca de mídias
  focusedClipId: string | null
  setFocusedClipId: (clipId: string | null) => void
}

export const usePlayoutSelection = create<PlayoutSelectionState>((set) => ({
  selectedByChannel: {},
  setSelected: (channelId, itemId) =>
    set((s) => ({ selectedByChannel: { ...s.selectedByChannel, [channelId]: itemId } })),
  clearSelected: (channelId) =>
    set((s) => ({ selectedByChannel: { ...s.selectedByChannel, [channelId]: null } })),
  focusedClipId: null,
  setFocusedClipId: (clipId) => set({ focusedClipId: clipId }),
}))
