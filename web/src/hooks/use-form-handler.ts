import { useState } from "react";
import { useToast } from "@/components/ui/use-toast";

interface UseFormHandlerOptions<T> {
  initialData: T;
  onSubmit: (data: T) => Promise<any>;
  validateForm?: (data: T) => string | null;
  successMessage?: string;
}

export function useFormHandler<T>({
  initialData,
  onSubmit,
  validateForm,
  successMessage = "Operation completed successfully",
}: UseFormHandlerOptions<T>) {
  const { toast } = useToast();
  const [isLoading, setIsLoading] = useState(false);
  const [formData, setFormData] = useState<T>(initialData);
  const [responseData, setResponseData] = useState<any>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (validateForm) {
      const error = validateForm(formData);
      if (error) {
        toast({
          variant: "destructive",
          title: "Error",
          description: error,
        });
        return;
      }
    }

    setIsLoading(true);

    try {
      const data = await onSubmit(formData);
      setResponseData(data);
      
      toast({
        title: "Success",
        description: successMessage,
      });

      setFormData(initialData);
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Error",
        description: error instanceof Error ? error.message : "An error occurred",
      });
    } finally {
      setIsLoading(false);
    }
  };

  return {
    formData,
    setFormData,
    isLoading,
    responseData,
    handleSubmit,
  };
}
