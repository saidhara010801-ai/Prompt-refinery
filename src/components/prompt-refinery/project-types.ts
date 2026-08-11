export interface Project {
  id: string;
  userId: string;
  name: string;
  description?: string;
  templateId?: string | null;
  defaultTechnique?: string;
  defaultGuidelines?: string[];
  status?: 'active' | 'trashed';
  trashedAt?: { seconds: number; nanoseconds: number } | null;
  purgeAt?: { seconds: number; nanoseconds: number } | null;
  createdAt?: {
    seconds: number;
    nanoseconds: number;
  };
  updatedAt?: {
    seconds: number;
    nanoseconds: number;
  };
}
