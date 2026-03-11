"use client";

import React, { useState } from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { MoreHorizontal, Edit, Trash2, User, Search, Filter } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ClientUser as UserType, UserRole, UserStatus } from "@/types/user";

interface UserTableProps {
  users: UserType[];
  onEdit: (user: UserType) => void;
  onDelete: (userId: string) => void;
  onViewDetails: (user: UserType) => void;
}

function getRoleColor(role: UserRole) {
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

function getStatusColor(status: UserStatus) {
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

function getInitials(firstName?: string, lastName?: string) {
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

function UserTable({ users, onEdit, onDelete, onViewDetails }: UserTableProps) {
  const [searchTerm, setSearchTerm] = useState("");
  const [roleFilter, setRoleFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");

  const filteredUsers = users.filter(user => {
    const matchesSearch = 
      user.email.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (user.first_name && user.first_name.toLowerCase().includes(searchTerm.toLowerCase())) ||
      (user.last_name && user.last_name.toLowerCase().includes(searchTerm.toLowerCase()));
    
    const matchesRole = roleFilter === "all" || user.role === roleFilter;
    const matchesStatus = statusFilter === "all" || user.status === statusFilter;


    return matchesSearch && matchesRole && matchesStatus;
  });


  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 h-4 w-4" />
          <Input
            placeholder="Search users..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-10"
          />
        </div>
        <div className="flex gap-2">
          <Select value={roleFilter} onValueChange={setRoleFilter}>
            <SelectTrigger className="w-[140px]">
              <SelectValue placeholder="Role" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Roles</SelectItem>
              <SelectItem value="admin">Admin</SelectItem>
              <SelectItem value="manager">Manager</SelectItem>
              <SelectItem value="interviewer">Interviewer</SelectItem>
              <SelectItem value="viewer">Viewer</SelectItem>
            </SelectContent>
          </Select>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-[140px]">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Status</SelectItem>
              <SelectItem value="active">Active</SelectItem>
              <SelectItem value="inactive">Inactive</SelectItem>
              <SelectItem value="pending">Pending</SelectItem>
              <SelectItem value="suspended">Suspended</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Table */}
      <div className="border rounded-lg">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>User</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>Role</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Joined</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredUsers.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center py-8 text-gray-500">
                  No users found
                </TableCell>
              </TableRow>
            ) : (
              filteredUsers.map((user) => {
                const initials = getInitials(user.first_name, user.last_name);
                const fullName = `${user.first_name || ""} ${user.last_name || ""}`.trim() || "No Name";


                return (
                  <TableRow key={user.id}>
                    <TableCell>
                      <div className="flex items-center space-x-3">
                        <Avatar className="h-8 w-8">
                          <AvatarImage 
                            src={normalizeImageUrl(user.avatar_url)} 
                            alt={fullName}
                            onError={(e) => {
                              // Hide broken images to prevent 404 errors
                              e.currentTarget.style.display = 'none';
                            }}
                          />
                          <AvatarFallback className="bg-blue-100 text-blue-800 text-xs">
                            {initials}
                          </AvatarFallback>
                        </Avatar>
                        <div>
                          <div className="font-medium">{fullName}</div>
                          {user.phone && (
                            <div className="text-sm text-gray-500">{user.phone}</div>
                          )}
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className="font-medium">{user.email}</TableCell>
                    <TableCell>
                      <Badge className={getRoleColor(user.role)}>
                        {user.role}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Badge className={getStatusColor(user.status)}>
                        {user.status}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {new Date(user.created_at).toLocaleDateString()}
                    </TableCell>
                    <TableCell className="text-right">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => onViewDetails(user)}>
                            <User className="mr-2 h-4 w-4" />
                            View Details
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => onEdit(user)}>
                            <Edit className="mr-2 h-4 w-4" />
                            Edit User
                          </DropdownMenuItem>
                          <DropdownMenuItem 
                            onClick={() => onDelete(user.id)}
                            className="text-red-600"
                          >
                            <Trash2 className="mr-2 h-4 w-4" />
                            Delete User
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>

      {/* Results count */}
      <div className="text-sm text-gray-500">
        Showing {filteredUsers.length} of {users.length} users
      </div>
    </div>
  );
};

export default UserTable;

