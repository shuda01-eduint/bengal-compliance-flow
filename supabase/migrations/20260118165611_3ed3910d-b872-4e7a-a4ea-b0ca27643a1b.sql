ALTER TABLE eod_run_history 
ADD CONSTRAINT eod_run_history_run_date_unique UNIQUE (run_date);