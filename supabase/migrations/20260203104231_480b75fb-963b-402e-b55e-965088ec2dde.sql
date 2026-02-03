-- Create processing_jobs table for background job tracking
CREATE TABLE IF NOT EXISTS public.processing_jobs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  job_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'processing',
  progress INTEGER DEFAULT 0,
  result JSONB,
  error TEXT,
  metadata JSONB,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  created_by UUID REFERENCES auth.users(id)
);

-- Enable RLS
ALTER TABLE public.processing_jobs ENABLE ROW LEVEL SECURITY;

-- Policies for processing jobs
CREATE POLICY "Users can view their own jobs" 
ON public.processing_jobs 
FOR SELECT 
USING (auth.uid() = created_by);

CREATE POLICY "Users can create jobs" 
ON public.processing_jobs 
FOR INSERT 
WITH CHECK (auth.uid() = created_by);

CREATE POLICY "Admins can view all jobs"
ON public.processing_jobs
FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM public.user_roles 
    WHERE user_id = auth.uid() AND role = 'admin'
  )
);

CREATE POLICY "Admins can update jobs"
ON public.processing_jobs
FOR UPDATE
USING (
  EXISTS (
    SELECT 1 FROM public.user_roles 
    WHERE user_id = auth.uid() AND role = 'admin'
  )
);

-- Create index for faster lookups
CREATE INDEX idx_processing_jobs_status ON public.processing_jobs(status);
CREATE INDEX idx_processing_jobs_created_by ON public.processing_jobs(created_by);