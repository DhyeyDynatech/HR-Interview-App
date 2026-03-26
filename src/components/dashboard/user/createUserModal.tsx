'use client';

import React, { useState, useEffect, useRef } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { InterviewAssignee, CreateAssigneeRequest, UpdateAssigneeRequest, ReviewStatus } from '@/types/user';
import { useAssignees } from '@/contexts/users.context';
import { useInterviews } from '@/contexts/interviews.context';
import { useAuth } from '@/contexts/auth.context';
import { useToast } from '@/components/ui/use-toast';
import { Interview } from '@/types/interview';
import { ResumeViewer } from './ResumeViewer';
import { FileText, Eye, X } from 'lucide-react';

interface CreateAssigneeModalProps {
  isOpen: boolean;
  onClose: () => void;
  assignee?: InterviewAssignee | null;
  mode: 'create' | 'edit';
}

export function CreateAssigneeModal({
  isOpen,
  onClose,
  assignee,
  mode
}: CreateAssigneeModalProps) {
  const [userImage, setUserImage] = useState<File | null>(null);
  const [imagePreviewUrl, setImagePreviewUrl] = useState<string | null>(null);
  const [showExistingImage, setShowExistingImage] = useState(true);
  const [resumeFile, setResumeFile] = useState<File | null>(null);
  const [showResumeViewer, setShowResumeViewer] = useState(false);
  const { addAssignee, updateAssignee, refreshAssignees } = useAssignees();
  const { interviews } = useInterviews();
  const { user } = useAuth();
  const { toast } = useToast();
  const [formError, setFormError] = useState<string | null>(null);
  
  const [formData, setFormData] = useState<CreateAssigneeRequest>({
    first_name: '',
    last_name: '',
    email: '',
    phone: '',
    avatar_url: '',
    resume_url: '',
    interview_id: '',
    organization_id: null,
    status: 'active',
    notes: '',
    tag: null,
    applicant_id: null,
    review_status: null
  });
  
  useEffect(() => {
    
    if (assignee && mode === 'edit') {
      const avatarUrl = assignee.avatar_url || '';
      setFormData({
        first_name: assignee.first_name || '',
        last_name: assignee.last_name || '',
        email: assignee.email || '',
        phone: assignee.phone || '',
        avatar_url: avatarUrl,
        resume_url: assignee.resume_url || '',
        interview_id: assignee.interview_id || '',
        organization_id: assignee.organization_id || null,
        status: assignee.status || 'active',
        notes: assignee.notes || '',
        tag: assignee.tag || null,
        applicant_id: assignee.applicant_id || null,
        review_status: assignee.review_status || null
      });
      // Don't show existing images to prevent 404 errors
      setShowExistingImage(false);
      setUserImage(null);
      setResumeFile(null);
      if (imagePreviewUrl) {
        URL.revokeObjectURL(imagePreviewUrl);
        setImagePreviewUrl(null);
      }
    } else if (mode === 'create') {
      setFormData({
        first_name: '',
        last_name: '',
        email: '',
        phone: '',
        avatar_url: '',
        resume_url: '',
        interview_id: '',
        organization_id: null,
        status: 'active',
        notes: '',
        tag: null,
        applicant_id: null,
        review_status: null
      });
      setShowExistingImage(false);
      setUserImage(null);
      setResumeFile(null);
      if (imagePreviewUrl) {
        URL.revokeObjectURL(imagePreviewUrl);
        setImagePreviewUrl(null);
      }
    }
  }, [assignee, mode]);


  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setFormError(null); // Clear any previous error

    console.log('Form submitted, userImage:', userImage ? `${userImage.name} (${userImage.size} bytes)` : 'null');

    try {
    // Create a copy of the form data to modify
    const updatedFormData = { ...formData };

    // If userImage is present, upload it first
    if (userImage) {
      console.log('Uploading image:', userImage.name, userImage.size, 'bytes');
      const imageFormData = new FormData();
      imageFormData.append("userImage", userImage);
      // Include organization context for cost tracking
      const imgOrgId = user?.organization_id;
      if (imgOrgId) {
        imageFormData.append("organizationId", imgOrgId);
      }
      if (user?.id) {
        imageFormData.append("userId", user.id);
      }

      const uploadRes = await fetch("/api/upload-user-image", {
        method: "POST",
        body: imageFormData,
      });

      if (!uploadRes.ok) {
        const errorData = await uploadRes.json().catch(() => ({ error: 'Unknown error' }));
        console.error('Image upload failed:', errorData);
        throw new Error(`Image upload failed: ${errorData.error || 'Unknown error'}`);
      }

      const { imageUrl } = await uploadRes.json();
      console.log('Image uploaded successfully:', imageUrl);
      // Update the avatar_url in the form data
      updatedFormData.avatar_url = imageUrl;
    }

    // If resumeFile is present, upload it
    if (resumeFile) {
      console.log('Uploading resume:', resumeFile.name, resumeFile.size, 'bytes');
      const resumeFormData = new FormData();
      resumeFormData.append("resume", resumeFile);
      // Include organization context for cost tracking and dedup
      const orgId = user?.organization_id;
      if (orgId) {
        resumeFormData.append("organizationId", orgId);
      }
      if (user?.id) {
        resumeFormData.append("userId", user.id);
      }

      const uploadRes = await fetch("/api/upload-resume", {
        method: "POST",
        body: resumeFormData,
      });

      if (!uploadRes.ok) {
        const errorData = await uploadRes.json().catch(() => ({ error: 'Unknown error' }));
        console.error('Resume upload failed:', errorData);

        // Duplicate candidate detected via email match
        if (uploadRes.status === 409 && errorData.isDuplicate) {
          const existingName = errorData.existingCandidate?.name
            ? ` (${errorData.existingCandidate.name})`
            : '';
          throw new Error(
            `duplicate_resume:A candidate with email "${errorData.duplicateEmail}" already exists${existingName}. Please check for duplicates.`
          );
        }

        throw new Error(`Resume upload failed: ${errorData.error || 'Unknown error'}`);
      }

      const { resumeUrl } = await uploadRes.json();
      console.log('Resume uploaded successfully:', resumeUrl);
      // Update the resume_url in the form data
      updatedFormData.resume_url = resumeUrl;
    }

    if (mode === 'create') {
      // Convert empty interview_id to null for database constraint
      const createData = {
        ...updatedFormData,
        interview_id: updatedFormData.interview_id || null,
        organization_id: updatedFormData.organization_id || null,
      };
      await addAssignee(createData);
      // Refresh the list after creating
      await refreshAssignees();
    } else if (assignee) {
      const updateData: UpdateAssigneeRequest = {
        first_name: updatedFormData.first_name,
        last_name: updatedFormData.last_name,
        email: updatedFormData.email,
        phone: updatedFormData.phone,
        // Convert empty string to null for database constraint
        interview_id: updatedFormData.interview_id || null,
        avatar_url: updatedFormData.avatar_url,
        resume_url: updatedFormData.resume_url,
        status: updatedFormData.status,
        notes: updatedFormData.notes,
        tag: updatedFormData.tag || null,
        applicant_id: updatedFormData.applicant_id || null,
        review_status: updatedFormData.review_status || null
      };
      await updateAssignee(assignee.id, updateData);
      // Refresh the list after updating
      await refreshAssignees();
    }

    // Blur any focused elements before closing
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
    
    onClose();
    setFormData({
      first_name: '',
      last_name: '',
      email: '',
      phone: '',
      interview_id: '',
      avatar_url: '',
      resume_url: '',
      organization_id: null,
      status: 'active',
      notes: '',
      tag: null,
      applicant_id: null,
      review_status: null
    });
    setUserImage(null); // Reset the image state
    setResumeFile(null); // Reset the resume state
    // Cleanup preview URL
    if (imagePreviewUrl) {
      URL.revokeObjectURL(imagePreviewUrl);
      setImagePreviewUrl(null);
    }
  } catch (error) {
    console.error('Error saving assignee:', error);

    // Parse the error message and show user-friendly feedback
    const errorMessage = error instanceof Error ? error.message : 'Failed to save assignee';

    // Duplicate resume detected (same candidate email found in the uploaded resume)
    if (errorMessage.startsWith('duplicate_resume:')) {
      const message = errorMessage.replace('duplicate_resume:', '');
      setFormError(message);
      toast({
        title: 'Duplicate Candidate',
        description: message,
        variant: 'destructive',
      });
    // Duplicate email entered manually in the form
    } else if (errorMessage.toLowerCase().includes('email already exists') ||
        errorMessage.toLowerCase().includes('duplicate') ||
        errorMessage.toLowerCase().includes('already exists')) {
      setFormError('This email is already registered. Please use a different email address.');
      toast({
        title: 'Email Already Exists',
        description: 'An assignee with this email already exists. Please try a different email.',
        variant: 'destructive',
      });
    } else {
      setFormError(errorMessage);
      toast({
        title: 'Error',
        description: errorMessage,
        variant: 'destructive',
      });
    }
    // Don't close the modal - keep form values intact
  } finally {
    setIsLoading(false);
  }
};

  function handleInputChange(field: keyof CreateAssigneeRequest, value: string | null) {
    setFormData(prev => ({
      ...prev,
      [field]: value
    }));
  };

  const handleInputChangeEvent = (field: keyof CreateAssigneeRequest) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    handleInputChange(field, e.target.value);
  };

  function handleImageChange(e: React.ChangeEvent<HTMLInputElement>) {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      console.log('File selected:', file.name, file.size, 'bytes');
      setUserImage(file);
      // Create preview URL for the selected file
      const previewUrl = URL.createObjectURL(file);
      setImagePreviewUrl(previewUrl);
    }
  };

  function handleResumeChange(e: React.ChangeEvent<HTMLInputElement>) {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      
      // Validate file type - PDF or Word
      const allowedTypes = ['application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/msword'];
      const allowedExts = ['.pdf', '.doc', '.docx'];
      const ext = file.name.toLowerCase().slice(file.name.lastIndexOf('.'));
      if (!allowedTypes.includes(file.type) && !allowedExts.includes(ext)) {
        alert('Please upload a PDF or Word file for the resume.');
        e.target.value = ''; // Reset input
        return;
      }

      // Validate file size (max 10MB)
      const maxSize = 10 * 1024 * 1024; // 10MB
      if (file.size > maxSize) {
        alert('Resume file size must be less than 10MB.');
        e.target.value = ''; // Reset input
        return;
      }

      console.log('Resume file selected:', file.name, file.size, 'bytes');
      setResumeFile(file);
    }
  };

  function handleRemoveResume() {
    setResumeFile(null);
    setFormData(prev => ({ ...prev, resume_url: '' }));
  };

  // Cleanup object URL when component unmounts or file changes
  useEffect(() => {

    return () => {
      if (imagePreviewUrl) {
        URL.revokeObjectURL(imagePreviewUrl);
      }
    };
  }, [imagePreviewUrl]);


  return (
    <Dialog open={isOpen} onOpenChange={(open) => {
      if (!open) {
        onClose();
      }
    }}>
      <DialogContent className="sm:max-w-[500px] max-h-[85vh] flex flex-col">
        <DialogHeader className="flex-shrink-0">
          <DialogTitle>
            {mode === 'create' ? 'Create New Assignee' : 'Edit Assignee'}
          </DialogTitle>
          <DialogDescription>
            Fill out the following details to {mode === 'create' ? 'create a new' : 'edit the'} assignee.
        </DialogDescription>
        </DialogHeader>
        
        <form
          onSubmit={(e) => {
            // prevent native submit bubbling/closing
            e.preventDefault();
            handleSubmit(e);
          }}
          className="space-y-4 overflow-y-auto flex-1 pr-2"
        >
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="first_name">First Name *</Label>
              <Input
                id="first_name"
                value={formData.first_name}
                onChange={handleInputChangeEvent('first_name')}
                placeholder="Enter first name"
                required
              />
            </div>
            
            <div className="space-y-2">
              <Label htmlFor="last_name">Last Name *</Label>
              <Input
                id="last_name"
                value={formData.last_name}
                onChange={handleInputChangeEvent('last_name')}
                placeholder="Enter last name"
                required
              />
            </div>
          </div>
            
          <div className="space-y-2">
            <Label htmlFor="email">Email *</Label>
            <Input
              id="email"
              type="email"
              value={formData.email}
              onChange={(e) => {
                handleInputChangeEvent('email')(e);
                // Clear error when user starts typing
                if (formError) setFormError(null);
              }}
              placeholder="Enter email address"
              required
              className={formError ? 'border-red-500 focus:ring-red-500' : ''}
            />
            {formError && (
              <p className="text-sm text-red-500 mt-1">{formError}</p>
            )}
          </div>
            
          <div className="space-y-2">
            <Label htmlFor="phone">Phone</Label>
            <Input
              id="phone"
              value={formData.phone}
              onChange={handleInputChangeEvent('phone')}
              placeholder="Enter phone number"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="applicant_id">Candidate ID</Label>
            <Input
              id="applicant_id"
              value={formData.applicant_id || ''}
              onChange={handleInputChangeEvent('applicant_id')}
              placeholder="Enter candidate ID (e.g., APP-20260120-00001)"
            />
            <p className="text-xs text-gray-500">
              Optional: Enter a unique identifier for tracking this candidate
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="interview_id">Interview</Label>
            <Select
              value={formData.interview_id || 'none'}
              onValueChange={(value) => handleInputChange('interview_id', value === 'none' ? '' : value)}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select interview" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">No Interview</SelectItem>
                {interviews.map((interview: Interview) => (
                  <SelectItem key={interview.id} value={interview.id}>
                    {interview.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="avatar_url">Profile Image</Label>
            <div className="flex flex-col gap-2">
              {/* Show preview for newly selected file */}
              {userImage && imagePreviewUrl && (
                <div className="flex items-center gap-3">
                  <img 
                    src={imagePreviewUrl} 
                    alt="Preview" 
                    className="w-20 h-20 object-cover rounded-full border-2 border-gray-200"
                  />
                  <div className="flex-1">
                    <p className="text-sm font-medium text-gray-700">
                      {userImage.name}
                    </p>
                    <p className="text-xs text-gray-500">
                      {(userImage.size / 1024).toFixed(2)} KB
                    </p>
                  </div>
                </div>
              )}
              {/* Show existing image preview if in edit mode */}
              {!userImage && formData.avatar_url && showExistingImage && (
                <img 
                  src={formData.avatar_url} 
                  alt="Current" 
                  className="w-20 h-20 object-cover rounded-full"
                />
              )}
              {/* Standard file input */}
              <Input
                type="file"
                name="userImage"
                accept="image/*"
                onChange={handleImageChange}
                className="cursor-pointer"
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="resume">Resume / CV (PDF)</Label>
            <div className="flex flex-col gap-2">
              {/* Show selected resume file */}
              {resumeFile && (
                <div className="flex items-center gap-3 p-3 border rounded-lg bg-gray-50">
                  <FileText className="h-8 w-8 text-blue-500" />
                  <div className="flex-1">
                    <p className="text-sm font-medium text-gray-700">
                      {resumeFile.name}
                    </p>
                    <p className="text-xs text-gray-500">
                      {(resumeFile.size / 1024).toFixed(2)} KB
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={handleRemoveResume}
                    className="text-red-500 hover:text-red-700"
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              )}
              {/* Show existing resume if in edit mode */}
              {!resumeFile && formData.resume_url && (
                <div className="flex items-center gap-3 p-3 border rounded-lg bg-gray-50">
                  <FileText className="h-8 w-8 text-green-500" />
                  <div className="flex-1">
                    <p className="text-sm font-medium text-gray-700">
                      Resume uploaded
                    </p>
                    <p className="text-xs text-gray-500">
                      Click view to see the current resume
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setShowResumeViewer(true)}
                    className="flex items-center gap-2"
                  >
                    <Eye className="h-4 w-4" />
                    View
                  </Button>
                </div>
              )}
              {/* File input for resume */}
              <Input
                type="file"
                name="resume"
                accept=".pdf,.doc,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/msword"
                onChange={handleResumeChange}
                className="cursor-pointer"
              />
              <p className="text-xs text-gray-500">
                Only PDF files are accepted. Maximum file size: 10MB
              </p>
            </div>
          </div>
        
          <div className="space-y-2">
            <Label htmlFor="status">Status</Label>
            <Select
              value={formData.status}
              onValueChange={(value) => handleInputChange('status', value)}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="active">Active</SelectItem>
                <SelectItem value="inactive">Inactive</SelectItem>
                <SelectItem value="pending">Pending</SelectItem>
              </SelectContent>
            </Select>
          </div>
          
          <div className="space-y-2">
            <Label htmlFor="tag">Department / Tag</Label>
            <Input
              id="tag"
              value={formData.tag || ''}
              onChange={handleInputChangeEvent('tag')}
              placeholder="Enter a tag (e.g., Frontend, Backend, Senior)"
            />
          </div>

          {/* <div className="space-y-2">
            <Label htmlFor="review_status">Review Status</Label>
            <Select
              value={formData.review_status || 'NO_STATUS'}
              onValueChange={(value) => handleInputChange('review_status', value === 'NO_STATUS' ? null : value as ReviewStatus)}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select review status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="NO_STATUS">
                  <div className="flex items-center">
                    <div className="w-3 h-3 bg-gray-400 rounded-full mr-2" />
                    To Be Reviewed
                  </div>
                </SelectItem>
                <SelectItem value="NOT_SELECTED">
                  <div className="flex items-center">
                    <div className="w-3 h-3 bg-red-500 rounded-full mr-2" />
                    Not Selected
                  </div>
                </SelectItem>
                <SelectItem value="POTENTIAL">
                  <div className="flex items-center">
                    <div className="w-3 h-3 bg-yellow-500 rounded-full mr-2" />
                    Potential
                  </div>
                </SelectItem>
                <SelectItem value="SELECTED">
                  <div className="flex items-center">
                    <div className="w-3 h-3 bg-green-500 rounded-full mr-2" />
                    Selected
                  </div>
                </SelectItem>
              </SelectContent>
            </Select>
          </div> */}
          
          <div className="space-y-2">
            <Label htmlFor="notes">Notes</Label>
            <Textarea
              id="notes"
              value={formData.notes}
              onChange={handleInputChangeEvent('notes')}
              placeholder="Enter any additional notes"
              rows={3}
            />
          </div>
        </form>
        
        <div className="flex justify-end space-x-2 pt-4 border-t flex-shrink-0 mt-4">
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={isLoading} onClick={handleSubmit}>
            {isLoading ? 'Saving...' : mode === 'create' ? 'Create Assignee' : 'Update Assignee'}
          </Button>
        </div>
      </DialogContent>

      {/* Resume Viewer Modal */}
      {formData.resume_url && (
        <ResumeViewer
          isOpen={showResumeViewer}
          onClose={() => setShowResumeViewer(false)}
          resumeUrl={formData.resume_url}
          assigneeName={assignee ? `${assignee.first_name} ${assignee.last_name}` : undefined}
        />
      )}
    </Dialog>
  );
};
