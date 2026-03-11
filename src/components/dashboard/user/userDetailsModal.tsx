"use client";

import React from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { ClientUser as UserType, UserRole, UserStatus } from "@/types/user";
import { Calendar, Mail, Phone, User, Shield, Activity } from "lucide-react";

interface UserDetailsModalProps {
  isOpen: boolean;
  onClose: () => void;
  user: UserType | null;
}

const getRoleColor = (role: UserRole) => {
  switch (role) {
    case "admin":

      return "bg-red-100 text-red-800";
    case "manager":

      return "bg-blue-100 text-blue-800";
    case "interviewer":

      return "bg-green-100 text-green-800";
    case "viewer":

      return "bg-gray-100 text-gray-800";
    default:

      return "bg-gray-100 text-gray-800";
  }
};

const getStatusColor = (status: UserStatus) => {
  switch (status) {
    case "active":

      return "bg-green-100 text-green-800";
    case "inactive":

      return "bg-gray-100 text-gray-800";
    case "pending":

      return "bg-yellow-100 text-yellow-800";
    case "suspended":

      return "bg-red-100 text-red-800";
    default:

      return "bg-gray-100 text-gray-800";
  }
};

const getInitials = (firstName?: string, lastName?: string) => {
  const first = firstName?.charAt(0) || "";
  const last = lastName?.charAt(0) || "";

  return (first + last).toUpperCase() || "U";
};

// Helper function to normalize image URLs to handle both cloud and legacy local paths
const normalizeImageUrl = (url: string | null | undefined): string | undefined => {
  if (!url) {
    return undefined;
  }
  
  // If it's already a full URL (from Vercel Blob or other cloud storage), return as-is
  if (url.startsWith('http://') || url.startsWith('https://')) {
    return url;
  }
  
  // Legacy: Handle old local file paths
  if (url.startsWith('/user-images/')) {
    try {
      // Decode URL encoding (%20 -> space, etc.)
      let decoded = decodeURIComponent(url);
      
      // Extract just the filename part
      const filename = decoded.replace('/user-images/', '');
      
      // Normalize the filename to match what's actually saved
      // The upload API replaces special chars with underscores: file.name.replace(/[^a-zA-Z0-9._-]/g, '_')
      // So we need to do the same normalization
      const normalizedFilename = filename.replace(/[^a-zA-Z0-9._-]/g, '_');
      
      return `/user-images/${normalizedFilename}`;
    } catch (error) {
      // If decoding fails, return undefined
      console.error('Error normalizing image URL:', url, error);

      return undefined;
    }
  }
  
  return undefined;
};

function UserDetailsModal({ isOpen, onClose, user }: UserDetailsModalProps) {
  if (!user) {
    return null;
  }

  const initials = getInitials(user.first_name, user.last_name);
  const fullName = `${user.first_name || ""} ${user.last_name || ""}`.trim() || "No Name";


  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-[600px]">
        <DialogHeader>
          <DialogTitle>User Details</DialogTitle>
        </DialogHeader>
        
        <div className="space-y-6">
          {/* User Header */}
          <div className="flex items-center space-x-4">
            <Avatar className="h-16 w-16">
              <AvatarImage 
                src={normalizeImageUrl(user.avatar_url)} 
                alt={fullName}
                onError={(e) => {
                  // Hide broken images to prevent 404 errors
                  e.currentTarget.style.display = 'none';
                }}
              />
              <AvatarFallback className="bg-blue-100 text-blue-800 text-lg">
                {initials}
              </AvatarFallback>
            </Avatar>
            <div className="flex-1">
              <h3 className="text-xl font-semibold">{fullName}</h3>
              <p className="text-gray-600">{user.email}</p>
              <div className="flex gap-2 mt-2">
                <Badge className={getRoleColor(user.role)}>
                  {user.role}
                </Badge>
                <Badge className={getStatusColor(user.status)}>
                  {user.status}
                </Badge>
              </div>
            </div>
          </div>

          <Separator />

          {/* Contact Information */}
          <div className="space-y-4">
            <h4 className="text-lg font-medium flex items-center gap-2">
              <User className="h-5 w-5" />
              Contact Information
            </h4>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="flex items-center space-x-3">
                <Mail className="h-4 w-4 text-gray-500" />
                <div>
                  <p className="text-sm text-gray-500">Email</p>
                  <p className="font-medium">{user.email}</p>
                </div>
              </div>
              {user.phone && (
                <div className="flex items-center space-x-3">
                  <Phone className="h-4 w-4 text-gray-500" />
                  <div>
                    <p className="text-sm text-gray-500">Phone</p>
                    <p className="font-medium">{user.phone}</p>
                  </div>
                </div>
              )}
            </div>
          </div>

          <Separator />

          {/* Account Information */}
          <div className="space-y-4">
            <h4 className="text-lg font-medium flex items-center gap-2">
              <Shield className="h-5 w-5" />
              Account Information
            </h4>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <p className="text-sm text-gray-500">User ID</p>
                <p className="font-mono text-sm">{user.id}</p>
              </div>
              <div>
                <p className="text-sm text-gray-500">Organization ID</p>
                <p className="font-mono text-sm">{user.organization_id}</p>
              </div>
              <div>
                <p className="text-sm text-gray-500">Role</p>
                <Badge className={getRoleColor(user.role)}>
                  {user.role}
                </Badge>
              </div>
              <div>
                <p className="text-sm text-gray-500">Status</p>
                <Badge className={getStatusColor(user.status)}>
                  {user.status}
                </Badge>
              </div>
            </div>
          </div>

          <Separator />

          {/* Timestamps */}
          <div className="space-y-4">
            <h4 className="text-lg font-medium flex items-center gap-2">
              <Calendar className="h-5 w-5" />
              Timestamps
            </h4>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <p className="text-sm text-gray-500">Created</p>
                <p className="font-medium">
                  {new Date(user.created_at).toLocaleString()}
                </p>
              </div>
              <div>
                <p className="text-sm text-gray-500">Last Updated</p>
                <p className="font-medium">
                  {new Date(user.updated_at).toLocaleString()}
                </p>
              </div>
              {user.last_login && (
                <div>
                  <p className="text-sm text-gray-500">Last Login</p>
                  <p className="font-medium">
                    {new Date(user.last_login).toLocaleString()}
                  </p>
                </div>
              )}
              {user.created_by && (
                <div>
                  <p className="text-sm text-gray-500">Created By</p>
                  <p className="font-mono text-sm">{user.created_by}</p>
                </div>
              )}
            </div>
          </div>

          {/* Avatar URL */}
          {user.avatar_url && (
            <>
              <Separator />
              <div className="space-y-4">
                <h4 className="text-lg font-medium">Avatar</h4>
                <div className="flex items-center space-x-3">
                  <Avatar className="h-12 w-12">
                    <AvatarImage 
                      src={normalizeImageUrl(user.avatar_url)} 
                      alt={fullName}
                      onError={(e) => {
                        // Hide broken images to prevent 404 errors
                        e.currentTarget.style.display = 'none';
                      }}
                    />
                    <AvatarFallback className="bg-blue-100 text-blue-800">
                      {initials}
                    </AvatarFallback>
                  </Avatar>
                  <div className="flex-1">
                    <p className="text-sm text-gray-500">Avatar URL</p>
                    <p className="font-mono text-sm break-all">{user.avatar_url}</p>
                  </div>
                </div>
              </div>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default UserDetailsModal;

