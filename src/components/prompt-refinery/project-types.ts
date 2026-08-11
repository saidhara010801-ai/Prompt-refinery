export interface Project {
  id: string;
  userId: string;
  name: string;
  description?: string;
  createdAt?: {
    seconds: number;
    nanoseconds: number;
  };
  updatedAt?: {
    seconds: number;
    nanoseconds: number;
  };
}
